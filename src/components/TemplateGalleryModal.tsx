import React, { useRef, useState, useEffect, useCallback } from 'react';
import { X, Upload, Sparkles, Loader, Star, Clock } from 'lucide-react';
import { getValidBearerToken } from '../utils/auth';
import { db, auth, storage } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

export interface TemplateSettings {
  fontFamily?: string; mainColor?: string; highlightColor?: string;
  specialMark?: string; extraPrompt?: string;
}
export interface ApplyParams {
  imageUrl: string; settings: TemplateSettings | null; resolvedExtraPrompt: string | null;
}
interface HistoryEntry {
  id: string; imageUrl: string; settings: TemplateSettings | null;
  resolvedExtraPrompt: string | null; timestamp: number; label: string;
}
interface TemplateItem {
  id: string; label: string; imageUrl: string; settings: TemplateSettings | null;
}

// ─── No local templates — all loaded from Google Drive ─────────────────────
const LOCAL_TEMPLATES: TemplateItem[] = [];

const STARRED_LS='templateGalleryStarred', HISTORY_LS='styleRefHistory', MAX_HISTORY=30, ANALYSIS_MODEL='gemini-3-flash-preview';

// ─── localStorage helpers (instant initial state + offline fallback) ─────────
function lsLoadStarred():Set<string>{try{return new Set(JSON.parse(localStorage.getItem(STARRED_LS)||'[]'));}catch{return new Set();}}
function lsSaveStarred(s:Set<string>){localStorage.setItem(STARRED_LS,JSON.stringify([...s]));}
function lsLoadHistory():HistoryEntry[]{try{return JSON.parse(localStorage.getItem(HISTORY_LS)||'[]');}catch{return[];}}
function lsSaveHistory(h:HistoryEntry[]){localStorage.setItem(HISTORY_LS,JSON.stringify(h));}

// ─── Compress data URL to small thumbnail before storing in Firestore ────────
async function compressImageUrl(imageUrl:string,maxW=200):Promise<string>{
  if(!imageUrl.startsWith('data:'))return imageUrl; // Drive/Storage URLs stay as-is
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>{
      const ratio=Math.min(maxW/img.width,1);
      const canvas=document.createElement('canvas');
      canvas.width=Math.round(img.width*ratio);
      canvas.height=Math.round(img.height*ratio);
      canvas.getContext('2d')?.drawImage(img,0,0,canvas.width,canvas.height);
      resolve(canvas.toDataURL('image/jpeg',0.6));
    };
    img.onerror=()=>resolve(imageUrl);
    img.src=imageUrl;
  });
}

// ─── Firebase helpers (sync across devices) ───────────────────────────────────
async function fbSave(starred:Set<string>,history:HistoryEntry[]){
  // Write to localStorage IMMEDIATELY (uncompressed) so re-open always has latest data
  lsSaveStarred(starred);
  lsSaveHistory(history.slice(0,MAX_HISTORY));
  // Then compress data URLs and write to Firestore asynchronously
  const user=auth.currentUser;if(!user)return;
  try{
    const safeHistory=await Promise.all(history.slice(0,MAX_HISTORY).map(async e=>({
      ...e,imageUrl:await compressImageUrl(e.imageUrl),
    })));
    await setDoc(doc(db,'users',user.uid,'templateGallery','data'),
      {starred:[...starred],history:safeHistory},{merge:false});
    lsSaveHistory(safeHistory); // update localStorage with compressed versions
  }catch(err){console.warn('[Firebase] templateGallery save failed:',err);}
}
// ─── Template index (Firestore + Firebase Storage) ──────────────────────────
interface StoredTemplate{name:string;url:string;settings:TemplateSettings|null;}
const TMPL_INDEX=doc(db,'templateGalleryIndex','v1');

async function loadIndexFromFirestore():Promise<StoredTemplate[]>{
  try{
    const snap=await getDoc(TMPL_INDEX);
    if(!snap.exists())return[];
    return(snap.data().templates??[]) as StoredTemplate[];
  }catch(err){console.warn('[Firestore] templateGalleryIndex load failed:',err);return[];}
}

async function syncDriveToFirebase(
  scriptUrl:string,
  onProgress:(done:number,total:number)=>void
):Promise<StoredTemplate[]>{
  const[listRes,settingsTxt]=await Promise.all([
    fetch(`${scriptUrl}?action=listTemplates`).then(r=>r.json()).catch(()=>[]),
    fetch(`${scriptUrl}?action=getTemplateSettings`).then(r=>r.text()).catch(()=>''),
  ]);
  const driveFiles:Array<{id:string;name:string}>=Array.isArray(listRes)?listRes:[];
  const parsedSettings=parseSettingsTxt(settingsTxt);
  const existing=await loadIndexFromFirestore();
  const existingNames=new Set(existing.map(t=>t.name));
  const newFiles=driveFiles.filter(f=>f?.id&&f?.name&&!existingNames.has(f.name));
  // Update settings for existing templates (in case txt changed)
  let allTemplates:StoredTemplate[]=existing.map(t=>({...t,settings:(parsedSettings[t.name]??t.settings) as TemplateSettings|null}));
  if(newFiles.length>0){
    let done=0;
    const BATCH=5;
    for(let i=0;i<newFiles.length;i+=BATCH){
      const batch=newFiles.slice(i,i+BATCH);
      const results=await Promise.allSettled(batch.map(async file=>{
        const proxy=await fetch(`${scriptUrl}?action=getThumbnail&fileId=${file.id}`).then(r=>r.json());
        if(!proxy.ok)throw new Error(proxy.error);
        const bytes=Uint8Array.from(atob(proxy.data),c=>c.charCodeAt(0));
        const blob=new Blob([bytes],{type:proxy.mimeType||'image/jpeg'});
        const storageRef=ref(storage,`templates/${file.name}`);
        await uploadBytes(storageRef,blob);
        const url=await getDownloadURL(storageRef);
        return{name:file.name,url,settings:parsedSettings[file.name]??null} as StoredTemplate;
      }));
      done+=BATCH;
      onProgress(Math.min(done,newFiles.length),newFiles.length);
      results.forEach(r=>r.status==='fulfilled'&&allTemplates.push(r.value));
    }
  }
  // Save updated index to Firestore
  try{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await setDoc(TMPL_INDEX,{templates:allTemplates as any[],updatedAt:Date.now()});
  }catch(err){console.warn('[Firestore] templateGalleryIndex save failed:',err);}
  return allTemplates;
}

async function fbLoad():Promise<{starred:Set<string>;history:HistoryEntry[]}|null>{
  const user=auth.currentUser;if(!user)return null;
  try{
    const snap=await getDoc(doc(db,'users',user.uid,'templateGallery','data'));
    if(!snap.exists())return null;
    const d=snap.data();
    return{starred:new Set(d.starred??[]),history:d.history??[]};
  }catch(err){console.warn('[Firebase] templateGallery load failed:',err);return null;}
}

function shuffleArray<T>(arr:T[]):T[]{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function parseSettingsTxt(txt:string):Record<string,TemplateSettings>{
  const result:Record<string,TemplateSettings>={};
  txt.split('\n').slice(1).forEach(line=>{
    const trim=line.trim();if(!trim)return;
    const dot=trim.indexOf('.');if(dot<0)return;
    const key=trim.slice(0,dot);const parts=trim.slice(dot+1).split('/');
    const s:TemplateSettings={};const[font,main,hi,mark,ep]=parts;
    if(font&&font!=='無')s.fontFamily=font;if(main&&main!=='無')s.mainColor=main;
    if(hi&&hi!=='無')s.highlightColor=hi;if(mark&&mark!=='無')s.specialMark=mark;
    if(ep&&ep.trim()&&ep.trim()!=='無')s.extraPrompt=ep.trim();
    result[`${key}.jpg`]=s;
  });
  return result;
}

type Tab='all'|'starred'|'history';
type ConflictChoice='replace'|'merge'|'keep';
interface Props{currentExtraPrompt:string;onClose:()=>void;onApply:(p:ApplyParams)=>void;}

const TemplateGalleryModal:React.FC<Props>=({currentExtraPrompt,onClose,onApply})=>{
  const fileInputRef=useRef<HTMLInputElement>(null);
  const scrollRef=useRef<HTMLDivElement>(null);
  const sentinelRef=useRef<HTMLDivElement>(null);
  const scrollTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  const historyRef=useRef<HistoryEntry[]>([]);

  const [tab,setTab]=useState<Tab>('all');
  // Initial state from localStorage (instant); Firebase will overwrite when ready
  const [starred,setStarred]=useState<Set<string>>(lsLoadStarred);
  const [history,setHistory]=useState<HistoryEntry[]>(()=>{const h=lsLoadHistory();historyRef.current=h;return h;});
  const [hoveredCard,setHoveredCard]=useState<string|null>(null);

  const [allItems,setAllItems]=useState<TemplateItem[]>(()=>shuffleArray(LOCAL_TEMPLATES));
  const [driveLoading,setDriveLoading]=useState(false);
  const [syncProgress,setSyncProgress]=useState<{done:number;total:number}|null>(null);
  const [visibleCount,setVisibleCount]=useState(15);

  const [conflictPending,setConflictPending]=useState<{imageUrl:string;settings:TemplateSettings;label:string}|null>(null);
  const [geminiPending,setGeminiPending]=useState<{imageUrl:string;existingSettings:TemplateSettings|null;label:string}|null>(null);
  const [isAnalyzing,setIsAnalyzing]=useState(false);
  const [analyzeError,setAnalyzeError]=useState<string|null>(null);

  // Keep historyRef in sync with latest history state
  useEffect(()=>{historyRef.current=history;},[history]);

  // ── 1) Preload history images immediately from localStorage, then Firebase ───
  useEffect(()=>{
    // Instant: preload from localStorage (already in state)
    historyRef.current.forEach(entry=>{
      if(entry.imageUrl&&!entry.imageUrl.startsWith('data:')){
        const img=new Image();img.src=entry.imageUrl;
      }
    });
    // Async: overwrite with Firebase data when ready
    fbLoad().then(data=>{
      if(!data)return;
      setStarred(data.starred);
      setHistory(data.history);
      historyRef.current=data.history;
      data.history.forEach(entry=>{
        if(entry.imageUrl&&!entry.imageUrl.startsWith('data:')){
          const img=new Image();img.src=entry.imageUrl;
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // ── 2) Load templates: Firestore first (fast), then sync new Drive→Firebase ──
  useEffect(()=>{
    const toItem=(t:StoredTemplate):TemplateItem=>({
      id:t.name,
      label:/^\d+\./.test(t.name)?`範本 ${t.name.split('.')[0]}`:t.name.replace(/\.[^.]+$/,'').slice(0,10),
      imageUrl:t.url,
      settings:t.settings,
    });
    const scriptUrl=localStorage.getItem('driveScriptUrl')||import.meta.env.VITE_DRIVE_SCRIPT_URL||'';
    setDriveLoading(true);
    // Step 1: Firestore index (instant on repeat visits)
    loadIndexFromFirestore().then(async cached=>{
      if(cached.length>0){
        setAllItems(shuffleArray(cached.map(toItem)));
        setVisibleCount(15);
        setDriveLoading(false);
      }
      // Step 2a: Firestore empty → immediately show Drive thumbnails as fallback
      if(cached.length===0&&scriptUrl){
        try{
          const[listRes,settingsTxt]=await Promise.all([
            fetch(`${scriptUrl}?action=listTemplates`).then(r=>r.json()).catch(()=>[]),
            fetch(`${scriptUrl}?action=getTemplateSettings`).then(r=>r.text()).catch(()=>''),
          ]);
          const files:Array<{id:string;name:string}>=Array.isArray(listRes)?listRes:[];
          if(files.length>0){
            const ps=parseSettingsTxt(settingsTxt);
            setAllItems(shuffleArray(files.filter(f=>f?.id&&f?.name).map(f=>({
              id:f.id,
              label:/^\d+\./.test(f.name)?`範本 ${f.name.split('.')[0]}`:f.name.replace(/\.[^.]+$/,'').slice(0,10),
              imageUrl:`https://drive.google.com/thumbnail?id=${f.id}&sz=w600`,
              settings:ps[f.name]??null,
            }))));
            setVisibleCount(15);
          }
        }catch(e){console.warn('[templates] Drive fallback failed:',e);}
        setDriveLoading(false);
      }else if(cached.length===0){
        setDriveLoading(false);
      }
      // Step 2b: background sync Drive → Firebase Storage (future fast loads)
      if(!scriptUrl)return;
      syncDriveToFirebase(scriptUrl,(done,total)=>{
        setSyncProgress({done,total});
      }).then(all=>{
        if(all.length>0)setAllItems(shuffleArray(all.map(toItem)));
        setVisibleCount(15);
        setSyncProgress(null);
      }).catch((err:unknown)=>{
        console.warn('[sync] Drive→Firebase failed:',err);
        setSyncProgress(null);
      });
    });
  },[]);

  // ── Reset visible count on tab change ─────────────────────────────────────
  useEffect(()=>{setVisibleCount(15);},[tab]);

  // ── Infinite scroll (debounced, [tab] dep prevents rapid-fire) ────────────
  useEffect(()=>{
    const sentinel=sentinelRef.current;const scroller=scrollRef.current;
    if(!sentinel||!scroller||tab==='history')return;
    const obs=new IntersectionObserver(
      ([entry])=>{
        if(!entry.isIntersecting||scrollTimerRef.current)return;
        scrollTimerRef.current=setTimeout(()=>{scrollTimerRef.current=null;setVisibleCount(v=>v+15);},200);
      },
      {root:scroller,rootMargin:'150px',threshold:0}
    );
    obs.observe(sentinel);
    return()=>{obs.disconnect();if(scrollTimerRef.current){clearTimeout(scrollTimerRef.current);scrollTimerRef.current=null;}};
  },[tab]);

  // ── Apply flow ────────────────────────────────────────────────────────────
  const finalizeApply=useCallback((imageUrl:string,settings:TemplateSettings|null,extraPrompt:string|null,label:string)=>{
    const entry:HistoryEntry={id:Date.now().toString(),imageUrl,settings,resolvedExtraPrompt:extraPrompt,timestamp:Date.now(),label};
    // Compute next synchronously using ref (not inside updater) so fbSave runs
    // BEFORE onApply closes the modal and unmounts the component
    const next=[entry,...historyRef.current.filter(h=>h.imageUrl!==imageUrl)].slice(0,MAX_HISTORY);
    historyRef.current=next;
    fbSave(starred,next); // writes localStorage immediately (sync part runs before onApply)
    setHistory(next);
    onApply({imageUrl,settings,resolvedExtraPrompt:extraPrompt});
  },[starred,onApply]);

  const checkConflictAndApply=(imageUrl:string,settings:TemplateSettings,label:string)=>{
    if(settings.extraPrompt&&currentExtraPrompt.trim())setConflictPending({imageUrl,settings,label});
    else finalizeApply(imageUrl,settings,settings.extraPrompt??null,label);
  };
  const handleTemplateClick=(item:TemplateItem)=>{
    setAnalyzeError(null);
    setGeminiPending({imageUrl:item.imageUrl,existingSettings:item.settings,label:item.label});
  };
  const handleUploadOwn=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{setAnalyzeError(null);setGeminiPending({imageUrl:ev.target?.result as string,existingSettings:null,label:'自訂圖片'});};
    reader.readAsDataURL(file);
  };
  const skipGemini=()=>{
    if(!geminiPending)return;
    const{imageUrl,existingSettings,label}=geminiPending;setGeminiPending(null);
    if(existingSettings!==null)checkConflictAndApply(imageUrl,existingSettings,label);
    else finalizeApply(imageUrl,null,null,label);
  };
  const runGeminiAnalysis=async()=>{
    if(!geminiPending)return;
    const apiKey=localStorage.getItem('vertexApiKey')||localStorage.getItem('geminiApiKey')||import.meta.env.VITE_VERTEX_API_KEY||'';
    const bearerToken=await getValidBearerToken();
    if(!bearerToken&&!apiKey){setAnalyzeError('找不到 API Key（請先在設定中填入 Gemini API Key）');return;}
    setIsAnalyzing(true);setAnalyzeError(null);
    try{
      let base64:string;let mimeType='image/jpeg';
      const{imageUrl,existingSettings,label}=geminiPending;
      if(imageUrl.startsWith('data:')){
        const[header,data]=imageUrl.split(',');base64=data;mimeType=header.match(/data:([^;]+)/)?.[1]??'image/jpeg';
      }else if(imageUrl.includes('drive.google.com/thumbnail')){
        // Drive thumbnails block CORS fetch — use Apps Script proxy instead
        const fileId=new URL(imageUrl).searchParams.get('id')||'';
        const scriptUrl=localStorage.getItem('driveScriptUrl')||import.meta.env.VITE_DRIVE_SCRIPT_URL||'';
        if(!fileId||!scriptUrl)throw new Error('無法取得 Drive fileId 或 Apps Script URL');
        const proxy=await fetch(`${scriptUrl}?fileId=${fileId}`).then(r=>r.json());
        if(!proxy.ok)throw new Error('Drive proxy 錯誤: '+proxy.error);
        base64=proxy.data;mimeType=proxy.mimeType||'image/jpeg';
      }else{
        const resp=await fetch(imageUrl);const blob=await resp.blob();mimeType=blob.type||'image/jpeg';
        base64=await new Promise<string>((res,rej)=>{const fr=new FileReader();fr.onload=()=>res((fr.result as string).split(',')[1]);fr.onerror=rej;fr.readAsDataURL(blob);});
      }
      const prompt=`請仔細分析這張投影片或設計風格圖的視覺風格，以 JSON 格式回傳建議設定。只回傳 JSON：\n{"fontFamily":"字體（Noto Sans/襯線體/等寬長字/草寫體）","mainColor":"主文字顏色","highlightColor":"重點標示方式","specialMark":"特殊標記或無","extraPrompt":"風格視覺特點50~150字"}`;
      const url=bearerToken
        ?`https://aiplatform.googleapis.com/v1/projects/${localStorage.getItem('gcpProjectId')||''}/locations/${localStorage.getItem('vertexRegion')||'us-central1'}/publishers/google/models/${ANALYSIS_MODEL}:generateContent`
        :`https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${ANALYSIS_MODEL}:generateContent?key=${apiKey}`;
      const hdrs:Record<string,string>={'Content-Type':'application/json'};
      if(bearerToken)hdrs['Authorization']=`Bearer ${bearerToken}`;
      const res=await fetch(url,{method:'POST',headers:hdrs,body:JSON.stringify({contents:[{role:'user',parts:[{inlineData:{mimeType,data:base64}},{text:prompt}]}]})});
      if(!res.ok){const t=await res.text();throw new Error(`Gemini API 錯誤 ${res.status}: ${t.slice(0,200)}`);}
      const json=await res.json();
      const raw=json?.candidates?.[0]?.content?.parts?.[0]?.text??'{}';
      const geminiSettings:TemplateSettings=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const merged=existingSettings?{...geminiSettings,...existingSettings}:geminiSettings;
      setGeminiPending(null);setIsAnalyzing(false);
      checkConflictAndApply(imageUrl,merged,label);
    }catch(err:any){setIsAnalyzing(false);setAnalyzeError(String(err?.message??err));}
  };
  const resolveConflict=(choice:ConflictChoice)=>{
    if(!conflictPending)return;
    const np=conflictPending.settings?.extraPrompt??'';
    const resolved=choice==='replace'?np:choice==='merge'?currentExtraPrompt.trim()+'\n'+np:currentExtraPrompt;
    const{imageUrl,settings,label}=conflictPending;setConflictPending(null);
    finalizeApply(imageUrl,settings,resolved,label);
  };
  const applyFromHistory=(entry:HistoryEntry)=>{
    setAnalyzeError(null);
    if(entry.resolvedExtraPrompt&&currentExtraPrompt.trim())
      setConflictPending({imageUrl:entry.imageUrl,settings:{...(entry.settings||{}),extraPrompt:entry.resolvedExtraPrompt},label:entry.label});
    else finalizeApply(entry.imageUrl,entry.settings,entry.resolvedExtraPrompt,entry.label);
  };
  const toggleStar=(id:string,e:React.MouseEvent)=>{
    e.stopPropagation();
    setStarred(prev=>{
      const next=new Set(prev);
      if(next.has(id))next.delete(id);else next.add(id);
      fbSave(next,history); // persist to Firebase + localStorage
      return next;
    });
  };

  // ── Render helpers ────────────────────────────────────────────────────────

  const renderTemplateCard=(item:TemplateItem)=>{
    const isStarred=starred.has(item.id);
    const isHovered=hoveredCard===item.id;
    return(
      <div key={item.id} style={{position:'relative',display:'inline-block',width:'100%',marginBottom:'0.75rem',breakInside:'avoid'}}
        onMouseEnter={()=>setHoveredCard(item.id)} onMouseLeave={()=>setHoveredCard(null)}>
        <button onClick={()=>handleTemplateClick(item)}
          style={{padding:0,border:`2px solid ${isHovered?'var(--accent-color)':'var(--border-color)'}`,borderRadius:'0.6rem',cursor:'pointer',background:'none',overflow:'hidden',display:'flex',flexDirection:'column',textAlign:'left',width:'100%',transition:'border-color 0.15s'}}>
          <img src={item.imageUrl} alt={item.label} style={{width:'100%',height:'auto',display:'block'}} onError={e=>{(e.currentTarget as HTMLImageElement).style.opacity='0.3';}}/>
          <div style={{padding:'0.35rem 0.5rem',fontSize:'0.7rem',color:'var(--text-secondary)',background:'var(--bg-secondary)',width:'100%',boxSizing:'border-box'}}>
            <span style={{fontWeight:700,color:'var(--text-primary)'}}>{item.label}</span>
            {item.settings
              ?<span style={{marginLeft:'0.3rem'}}>{item.settings.fontFamily}{item.settings.highlightColor?` · ${item.settings.highlightColor}`:''}</span>
              :<span style={{marginLeft:'0.3rem',color:'var(--accent-color)',fontStyle:'italic'}}><Sparkles size={9} style={{verticalAlign:'middle'}}/> AI 分析</span>}
          </div>
        </button>
        {(isHovered||isStarred)&&(
          <button onClick={(e)=>toggleStar(item.id,e)}
            style={{position:'absolute',top:'0.3rem',right:'0.3rem',background:'rgba(0,0,0,0.5)',border:'none',borderRadius:'50%',width:'24px',height:'24px',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',padding:0}}>
            <Star size={13} fill={isStarred?'#f6c90e':'none'} color={isStarred?'#f6c90e':'#fff'}/>
          </button>
        )}
      </div>
    );
  };

  const renderHistoryCard=(entry:HistoryEntry)=>(
    <div key={entry.id} style={{display:'inline-block',width:'100%',marginBottom:'0.75rem',breakInside:'avoid'}}>
      <button onClick={()=>applyFromHistory(entry)}
        style={{padding:0,border:'2px solid var(--border-color)',borderRadius:'0.6rem',cursor:'pointer',background:'none',overflow:'hidden',display:'flex',flexDirection:'column',textAlign:'left',width:'100%',transition:'border-color 0.15s'}}
        onMouseEnter={e=>(e.currentTarget.style.borderColor='var(--accent-color)')}
        onMouseLeave={e=>(e.currentTarget.style.borderColor='var(--border-color)')}>
        <img src={entry.imageUrl} alt={entry.label} style={{width:'100%',height:'auto',display:'block'}} onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none';}}/>
        <div style={{padding:'0.4rem 0.5rem',fontSize:'0.7rem',background:'var(--bg-secondary)',width:'100%',boxSizing:'border-box'}}>
          <div style={{fontWeight:700,color:'var(--text-primary)'}}>{entry.label}</div>
          {entry.settings?.fontFamily&&<div style={{color:'var(--text-secondary)'}}>{entry.settings.fontFamily}{entry.settings.highlightColor?` · ${entry.settings.highlightColor}`:''}</div>}
          {entry.resolvedExtraPrompt&&<div style={{color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{entry.resolvedExtraPrompt.slice(0,40)}{entry.resolvedExtraPrompt.length>40?'…':''}</div>}
          <div style={{color:'var(--text-secondary)',marginTop:'0.1rem',fontSize:'0.65rem'}}>{new Date(entry.timestamp).toLocaleDateString()}</div>
        </div>
      </button>
    </div>
  );

  const starredItems=allItems.filter(t=>starred.has(t.id));
  const tabItems=tab==='all'?allItems:tab==='starred'?starredItems:[];
  const visibleItems=tabItems.slice(0,visibleCount);
  const hasMore=visibleCount<tabItems.length;

  // ── JSX ──────────────────────────────────────────────────────────────────
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}} onClick={onClose}>
      <div style={{background:'var(--bg-primary)',borderRadius:'1.1rem',width:'100%',maxWidth:'900px',maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 16px 50px rgba(0,0,0,0.35)'}} onClick={e=>e.stopPropagation()}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0.85rem 1.25rem',borderBottom:'1px solid var(--border-color)',flexShrink:0}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
            <span style={{fontWeight:700,fontSize:'1rem'}}>風格參考</span>
            <div style={{display:'flex',gap:'0.2rem'}}>
              {(['all','starred','history'] as Tab[]).map(t=>(
                <button key={t} onClick={()=>setTab(t)}
                  style={{padding:'0.28rem 0.7rem',fontSize:'0.78rem',fontWeight:tab===t?700:400,borderRadius:'0.4rem',border:'none',cursor:'pointer',background:tab===t?'var(--accent-color)':'transparent',color:tab===t?'#fff':'var(--text-secondary)'}}>
                  {t==='all'
                    ?<>{driveLoading?<Loader size={10} style={{verticalAlign:'middle',marginRight:'0.3rem',animation:'spin 1s linear infinite'}}/>:null}範本{driveLoading?' (載入中…)':`(${allItems.length})`}</>
                    :t==='starred'?<><Star size={11} style={{verticalAlign:'middle',marginRight:'0.2rem'}}/>收藏 ({starredItems.length})</>
                    :<><Clock size={11} style={{verticalAlign:'middle',marginRight:'0.2rem'}}/>歷史 ({history.length})</>}
                </button>
              ))}
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'0.6rem'}}>
            <button onClick={()=>fileInputRef.current?.click()}
              style={{display:'flex',alignItems:'center',gap:'0.4rem',padding:'0.35rem 0.8rem',fontSize:'0.8rem',fontWeight:600,borderRadius:'0.5rem',border:'1px solid var(--border-color)',background:'var(--bg-secondary)',cursor:'pointer',color:'var(--text-primary)'}}>
              <Upload size={13}/> 上傳圖片
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handleUploadOwn}/>
            <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'var(--text-secondary)',padding:'0.25rem'}}><X size={18}/></button>
          </div>
        </div>

        {syncProgress&&(
          <div style={{padding:'0.45rem 1.25rem',fontSize:'0.76rem',color:'var(--text-secondary)',background:'var(--bg-secondary)',borderBottom:'1px solid var(--border-color)',flexShrink:0,display:'flex',alignItems:'center',gap:'0.6rem'}}>
            <Loader size={12} style={{animation:'spin 1s linear infinite',flexShrink:0}}/>
            <span>同步新範本到 Firebase … {syncProgress.done}/{syncProgress.total}</span>
            <div style={{flex:1,height:'4px',background:'var(--border-color)',borderRadius:'2px',overflow:'hidden'}}>
              <div style={{height:'100%',background:'var(--accent-color)',width:`${Math.round(syncProgress.done/syncProgress.total*100)}%`,transition:'width 0.3s'}}/>
            </div>
          </div>
        )}

        {/* Gemini prompt */}
        {geminiPending&&(
          <div style={{padding:'0.85rem 1.25rem',background:'var(--bg-secondary)',borderBottom:'1px solid var(--border-color)',flexShrink:0,display:'flex',alignItems:'flex-start',gap:'1rem'}}>
            <img src={geminiPending.imageUrl} alt="preview" style={{width:'80px',height:'54px',objectFit:'cover',borderRadius:'0.4rem',border:'1px solid var(--border-color)',flexShrink:0}}/>
            <div style={{flex:1}}>
              <p style={{margin:'0 0 0.3rem',fontWeight:700,fontSize:'0.88rem'}}>
                <Sparkles size={13} style={{verticalAlign:'middle',marginRight:'0.3rem',color:'var(--accent-color)'}}/>
                用 gemini-3-flash-preview 分析圖片並自動填入設定嗎？
              </p>
              <p style={{margin:'0 0 0.55rem',fontSize:'0.76rem',color:'var(--text-secondary)'}}>
                {geminiPending.existingSettings?'Gemini 會補齊未設定的欄位（已有的預設設定會保留）。':'Gemini 會根據圖片風格建議字體、顏色及額外提示詞。'}
                {currentExtraPrompt.trim()&&' （已有額外提示詞，套用後會詢問是否合併）'}
              </p>
              {analyzeError&&<p style={{margin:'0 0 0.5rem',fontSize:'0.76rem',color:'#e53e3e'}}>⚠ {analyzeError}</p>}
              <div style={{display:'flex',gap:'0.5rem'}}>
                <button onClick={runGeminiAnalysis} disabled={isAnalyzing} style={btnStyle('var(--accent-color)','#fff',isAnalyzing)}>
                  {isAnalyzing?<><Loader size={12} style={{animation:'spin 1s linear infinite',marginRight:'0.3rem',verticalAlign:'middle'}}/>分析中...</>:<><Sparkles size={12} style={{marginRight:'0.3rem',verticalAlign:'middle'}}/>是，自動分析</>}
                </button>
                <button onClick={skipGemini} disabled={isAnalyzing} style={btnStyle('var(--bg-primary)','var(--text-secondary)',isAnalyzing)}>直接套用</button>
              </div>
            </div>
          </div>
        )}

        {/* Conflict dialog */}
        {conflictPending&&(
          <div style={{padding:'0.85rem 1.25rem',background:'var(--bg-secondary)',borderBottom:'1px solid var(--border-color)',flexShrink:0}}>
            <p style={{margin:'0 0 0.4rem',fontWeight:700,fontSize:'0.88rem'}}>你已有額外提示詞，要怎麼處理？</p>
            <p style={{margin:'0 0 0.55rem',fontSize:'0.76rem',color:'var(--text-secondary)'}}><strong>新提示詞：</strong>{conflictPending.settings?.extraPrompt}</p>
            <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
              <button onClick={()=>resolveConflict('replace')} style={btnStyle('var(--accent-color)','#fff')}>取代</button>
              <button onClick={()=>resolveConflict('merge')}   style={btnStyle('var(--bg-primary)','var(--text-primary)')}>合併</button>
              <button onClick={()=>resolveConflict('keep')}    style={btnStyle('var(--bg-primary)','var(--text-secondary)')}>保留原本</button>
            </div>
          </div>
        )}

        {/* Scrollable grid */}
        <div ref={scrollRef} style={{overflowY:'auto',padding:'1rem 1.25rem',flex:1}}>
          <div style={{columnCount:3,columnGap:'0.75rem'}}>
            {tab==='history'
              ?(history.length>0?history.map(renderHistoryCard):<p style={{color:'var(--text-secondary)',fontSize:'0.85rem'}}>尚無歷史記錄</p>)
              :(visibleItems.length>0?visibleItems.map(renderTemplateCard):<p style={{color:'var(--text-secondary)',fontSize:'0.85rem'}}>{tab==='starred'?'尚無收藏':'Drive 模板載入中…'}</p>)}
          </div>
          {hasMore&&tab!=='history'&&<div ref={sentinelRef} style={{height:'40px',display:'flex',alignItems:'center',justifyContent:'center'}}>
            <Loader size={16} style={{animation:'spin 1s linear infinite',color:'var(--text-secondary)'}}/>
          </div>}
        </div>

      </div>
    </div>
  );
};

const btnStyle=(bg:string,color:string,disabled=false):React.CSSProperties=>({
  padding:'0.35rem 0.8rem',fontSize:'0.78rem',fontWeight:600,borderRadius:'0.4rem',
  border:'1px solid var(--border-color)',background:bg,color,cursor:disabled?'not-allowed':'pointer',
  opacity:disabled?0.6:1,display:'inline-flex',alignItems:'center',
});

export default TemplateGalleryModal;
