import React, { useRef, useState, useEffect } from 'react';
import { X, Upload, Sparkles, Loader, Star, Clock } from 'lucide-react';
import { getValidBearerToken } from '../utils/auth';

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
  id: string;        // unique key (local filename or Drive file ID)
  label: string;
  imageUrl: string;  // ready-to-use image URL
  settings: TemplateSettings | null;
}

// ─── No local templates — all loaded from Google Drive ─────────────────────
const LOCAL_TEMPLATES: TemplateItem[] = [];

const STARRED_KEY='templateGalleryStarred', HISTORY_KEY='styleRefHistory', MAX_HISTORY=30, ANALYSIS_MODEL='gemini-3-flash-preview';
function loadStarred():Set<string>{try{return new Set(JSON.parse(localStorage.getItem(STARRED_KEY)||'[]'));}catch{return new Set();}}
function saveStarred(s:Set<string>){localStorage.setItem(STARRED_KEY,JSON.stringify([...s]));}
function loadHistory():HistoryEntry[]{try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch{return[];}}
function pushToHistory(e:HistoryEntry){const p=loadHistory().filter(h=>h.imageUrl!==e.imageUrl);localStorage.setItem(HISTORY_KEY,JSON.stringify([e,...p].slice(0,MAX_HISTORY)));}
function shuffleArray<T>(arr:T[]):T[]{const a=[...arr];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function parseSettingsTxt(txt:string):Record<string,TemplateSettings>{
  const result:Record<string,TemplateSettings>={};
  txt.split('\n').slice(1).forEach(line=>{
    const trim=line.trim();if(!trim)return;
    const dot=trim.indexOf('.');if(dot<0)return;
    const key=trim.slice(0,dot);
    const parts=trim.slice(dot+1).split('/');
    const s:TemplateSettings={};
    const[font,main,hi,mark,ep]=parts;
    if(font&&font!=='無')s.fontFamily=font;
    if(main&&main!=='無')s.mainColor=main;
    if(hi&&hi!=='無')s.highlightColor=hi;
    if(mark&&mark!=='無')s.specialMark=mark;
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

  const [tab,setTab]=useState<Tab>('all');
  const [starred,setStarred]=useState<Set<string>>(loadStarred);
  const [history,setHistory]=useState<HistoryEntry[]>(loadHistory);
  const [hoveredCard,setHoveredCard]=useState<string|null>(null);

  // allItems: starts as shuffled local fallback, replaced when Drive loads
  const [allItems,setAllItems]=useState<TemplateItem[]>(()=>shuffleArray(LOCAL_TEMPLATES));
  const [driveLoading,setDriveLoading]=useState(false);
  const [driveError,setDriveError]=useState<string|null>(null);
  const [visibleCount,setVisibleCount]=useState(15);

  const [conflictPending,setConflictPending]=useState<{imageUrl:string;settings:TemplateSettings;label:string}|null>(null);
  const [geminiPending,setGeminiPending]=useState<{imageUrl:string;existingSettings:TemplateSettings|null;label:string}|null>(null);
  const [isAnalyzing,setIsAnalyzing]=useState(false);
  const [analyzeError,setAnalyzeError]=useState<string|null>(null);

  // ── Load from Drive on mount ──────────────────────────────────────────────
  useEffect(()=>{
    const scriptUrl=localStorage.getItem('driveScriptUrl')||import.meta.env.VITE_DRIVE_SCRIPT_URL||'';
    if(!scriptUrl)return;
    setDriveLoading(true);setDriveError(null);
    Promise.allSettled([
      fetch(`${scriptUrl}?action=listTemplates`).then(r=>{if(!r.ok)throw new Error(r.status.toString());return r.json();}),
      fetch(`${scriptUrl}?action=getTemplateSettings`).then(r=>r.text()),
    ]).then(([listRes,txtRes])=>{
      const files:Array<{id:string;name:string}>=listRes.status==='fulfilled'?listRes.value:[];
      const txt:string=txtRes.status==='fulfilled'?txtRes.value:'';
      if(!Array.isArray(files)||files.length===0){setDriveLoading(false);return;}
      const parsedSettings=parseSettingsTxt(txt);
      const items:TemplateItem[]=files
        .filter(f=>f?.id&&f?.name)
        .map(f=>({
          id:f.id,
          label:/^\d+\./.test(f.name)?`範本 ${f.name.split('.')[0]}`:f.name.slice(0,8),
          imageUrl:`https://drive.google.com/thumbnail?id=${f.id}&sz=w600`,
          settings:parsedSettings[f.name]??null,
        }));
      setAllItems(shuffleArray(items));
      setVisibleCount(15);
      setDriveLoading(false);
    }).catch(()=>{setDriveError('無法載入 Drive 模板，顯示本機模板');setDriveLoading(false);});
  },[]);

  // Reset visible count when switching tabs
  useEffect(()=>{setVisibleCount(15);},[tab]);

  // ── Infinite scroll (debounced — deps:[tab] prevents rapid-fire on re-render) ──
  const scrollTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{
    const sentinel=sentinelRef.current;const scroller=scrollRef.current;
    if(!sentinel||!scroller||tab==='history')return;
    const obs=new IntersectionObserver(
      ([entry])=>{
        if(!entry.isIntersecting||scrollTimerRef.current)return;
        scrollTimerRef.current=setTimeout(()=>{
          scrollTimerRef.current=null;
          setVisibleCount(v=>v+15);
        },200);
      },
      {root:scroller,rootMargin:'150px',threshold:0}
    );
    obs.observe(sentinel);
    return()=>{
      obs.disconnect();
      if(scrollTimerRef.current){clearTimeout(scrollTimerRef.current);scrollTimerRef.current=null;}
    };
  },[tab]);

  // ── Apply flow ────────────────────────────────────────────────────────────
  const finalizeApply=(imageUrl:string,settings:TemplateSettings|null,extraPrompt:string|null,label:string)=>{
    pushToHistory({id:Date.now().toString(),imageUrl,settings,resolvedExtraPrompt:extraPrompt,timestamp:Date.now(),label});
    setHistory(loadHistory());
    onApply({imageUrl,settings,resolvedExtraPrompt:extraPrompt});
  };
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
    e.stopPropagation();const next=new Set(starred);
    if(next.has(id))next.delete(id);else next.add(id);
    setStarred(next);saveStarred(next);
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

        {driveError&&<div style={{padding:'0.5rem 1.25rem',fontSize:'0.76rem',color:'#b7791f',background:'#fffbeb',borderBottom:'1px solid var(--border-color)',flexShrink:0}}>⚠ {driveError}</div>}

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
              :(visibleItems.length>0?visibleItems.map(renderTemplateCard):<p style={{color:'var(--text-secondary)',fontSize:'0.85rem'}}>尚無收藏</p>)}
          </div>
          {/* Infinite scroll sentinel */}
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
