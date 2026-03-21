import React, { useRef, useState } from 'react';
import { X, Upload, Sparkles, Loader, Star, Clock } from 'lucide-react';
import { getValidBearerToken } from '../utils/auth';

export interface TemplateSettings {
  fontFamily?: string;
  mainColor?: string;
  highlightColor?: string;
  specialMark?: string;
  extraPrompt?: string;
}
export interface ApplyParams {
  imageUrl: string;
  settings: TemplateSettings | null;
  resolvedExtraPrompt: string | null;
}
interface HistoryEntry {
  id: string; imageUrl: string; settings: TemplateSettings | null;
  resolvedExtraPrompt: string | null; timestamp: number; label: string;
}
interface TemplateItem { filename: string; label: string; settings: TemplateSettings | null; }

const TEMPLATE_SETTINGS: Record<number, TemplateSettings> = {
  1: { fontFamily: '襯線體',    mainColor: '黑色', highlightColor: '黑底白字' },
  2: { fontFamily: 'Noto Sans', mainColor: '黑色', highlightColor: '黑字加底線', extraPrompt: '真實照片風景圖去背加文字，圖可以有山、植物、樹、森林、葉子、花朵、種子、動植物等等' },
  3: { fontFamily: 'Noto Sans', mainColor: '黑色', highlightColor: '黑底白字',   extraPrompt: '3d物體用真實的植物或相關物品(跟該投影片相關，元素不要太多，不要太複雜太花俏)(例如只要一個樹枝或葉子或花或果實或種子，任何植物都可以，碳匯、esg元素也可以，用有顏色的，不要全純黑)，小插圖用純黑色線條，不准出現任何香蕉(或有香蕉的元素)' },
};

const HASH_TEMPLATES: string[] = [
  '053b0d4c16c9d987afe735c9fdc5c03f.jpg','065f97edbcf0a57c14599098c397cf04.jpg',
  '084bd8b724458c37e461913b6106197d.jpg','0b2fdeb0032f2c86db30ac47dbc0cb3d.jpg',
  '0d62cafb6688af3d3d61c47244a373c8.jpg','12fb3f36e01bbdef44b5ca8769f06a9f.jpg',
  '137afa0569a5df03b43cae92b613e1ba.jpg','143f61a426b173395d0a22f21f1fc632.jpg',
  '169715054f5878657a21cc8139c280bc.jpg','17f7e67ccb97d3ee079132d7a3bcd959.jpg',
  '18e031810593ac3db0aa2173d76d85b6.jpg','1a8052630216f0a0d899ba28485a4dd5.jpg',
  '20870d65e19659b9a5a9d355d7cd7ecc.jpg','223d135a216e5ff2276d4497d771d918.jpg',
  '29c22a5590a831ca538f738d761ae431.jpg','2ab16516050fd6d275dec25cb0805c34.jpg',
  '302d5389d127fdeba88cbe9488c517ff.jpg','34a22b5716248554c72013a04e58242a.jpg',
  '35aa948ac1ed67b21618523f674bd3c4.jpg','42cef390987bfe3cd68e4d54d189d629.jpg',
  '436ba48e32cb401863b82113295c8cb6.jpg','472a3e1b07d55aecdb7d207a14b23a7b.jpg',
  '4c3a0a3d3643742304e5344d98d11ec9.jpg','4c73da5e0063a94cd80b1634ca0c0609.jpg',
  '534f407e9c135c1dd5a49739f30731ce.jpg','558b7374890e7eae8ee1f27df0402ddd.jpg',
  '5810879c155d516833e11684027f5bdf.jpg','5a93753dbe5530093c136381a8133710.jpg',
  '5f0519f3770bc2075dc988272be1afcd.jpg','616b9771b3f2a3dbc21f76742f102f41.jpg',
  '66873b2dc885c4a8f8117ee85de189e3.jpg','69d1791ead945fad886ed68b43509283.jpg',
  '6ca7a9e23367a0ce90c0c0a302d39934.jpg','70da481ecfdd0c33212c180d79295c3c.jpg',
  '736a333006c1c88e1a9055c8b7799e39.jpg','77db7a19102ce7d87f43edcc031d46ac.jpg',
  '7da210f55a5e799ffeeb20570d76677b.jpg','80232e7afc00496e2de25b2cfec30df7.jpg',
  '840e70eebd994817ff2154f663c53e8e.jpg','8423a2f3bc39bfe517e0b781be8ee706.jpg',
  '8838abf50031496eb6e9020437c8c06f.jpg','8b44c09efd198d7e6bb7b024719f80da.jpg',
  '8f40e426cb0a740dfc85c23c19a28b4a.jpg','9015377b3984d10b481469657f37cd81.jpg',
  '91fb25dd72755e37c7b47dfb8c485dac.jpg','9c4b4d9bf39029523a887d05f351130c.jpg',
  '9ef822a08f6d15a20713969691a5dbf5.jpg','a0fe191ee30fbcc9f1152838623f51f4.jpg',
  'a47d4af5b8cec4354e294fcd55d2a424.jpg','abb448a28ba5ffc4306bdcc67ddc4871.jpg',
  'aef3e2d37f691415539e1db510174b9d.jpg','aff9b83b8febf5850f3fb18108088548.jpg',
  'b60d41f2fb2fc35c6d9cb75a3e054f18.jpg','b6e0443bf06e9bd60b2e06914965f30b.jpg',
  'b6ef4f9bb6149238fd6c42ff318783a0.jpg','bda4cfe8890cf01622307686cbf3cc6a.jpg',
  'bffa576b4b654f5042a2ee300d0e642c.jpg','c3dbb5f75c8176531863a310eaf7614e.jpg',
  'c5680b9da0762e7db9b1be57704e5c6a.jpg','c83a9c5b0bed3711023cce52ca195256.jpg',
  'ca1ccaa4298e7159d84d9ffbeb2d82f0.jpg','ccb0abed7227b5c712ebf90c3265c1f6.jpg',
  'dc90cbd5bb988054db83a6548e7816d0.jpg','e1212c0f6b3beff3e45ab1b598c8bfc9.jpg',
  'ece66cf099a023e6258528f96c968f40.jpg','f1c4cf0f66736db24f4368f9959bc450.jpg',
];
const NUMBERED: TemplateItem[] = Array.from({length:36},(_,i)=>({filename:`${i+1}.jpg`,label:`範本 ${i+1}`,settings:TEMPLATE_SETTINGS[i+1]??null}));
const HASH: TemplateItem[] = HASH_TEMPLATES.map(f=>({filename:f,label:f.slice(0,8),settings:null}));
const ALL_TEMPLATES: TemplateItem[] = [...NUMBERED, ...HASH];

const STARRED_KEY='templateGalleryStarred', HISTORY_KEY='styleRefHistory', MAX_HISTORY=30, ANALYSIS_MODEL='gemini-3-flash-preview';
function loadStarred():Set<string>{try{return new Set(JSON.parse(localStorage.getItem(STARRED_KEY)||'[]'));}catch{return new Set();}}
function saveStarred(s:Set<string>){localStorage.setItem(STARRED_KEY,JSON.stringify([...s]));}
function loadHistory():HistoryEntry[]{try{return JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');}catch{return[];}}
function pushToHistory(e:HistoryEntry){const p=loadHistory().filter(h=>h.imageUrl!==e.imageUrl);localStorage.setItem(HISTORY_KEY,JSON.stringify([e,...p].slice(0,MAX_HISTORY)));}

type Tab='all'|'starred'|'history';
type ConflictChoice='replace'|'merge'|'keep';
interface Props{currentExtraPrompt:string;onClose:()=>void;onApply:(p:ApplyParams)=>void;}

const TemplateGalleryModal:React.FC<Props>=({currentExtraPrompt,onClose,onApply})=>{
  const fileInputRef=useRef<HTMLInputElement>(null);
  const [tab,setTab]=useState<Tab>('all');
  const [starred,setStarred]=useState<Set<string>>(loadStarred);
  const [history,setHistory]=useState<HistoryEntry[]>(loadHistory);
  const [hoveredCard,setHoveredCard]=useState<string|null>(null);
  const [conflictPending,setConflictPending]=useState<{imageUrl:string;settings:TemplateSettings;label:string}|null>(null);
  const [geminiPending,setGeminiPending]=useState<{imageUrl:string;existingSettings:TemplateSettings|null;label:string}|null>(null);
  const [isAnalyzing,setIsAnalyzing]=useState(false);
  const [analyzeError,setAnalyzeError]=useState<string|null>(null);

  const finalizeApply=(imageUrl:string,settings:TemplateSettings|null,extraPrompt:string|null,label:string)=>{
    const entry:HistoryEntry={id:Date.now().toString(),imageUrl,settings,resolvedExtraPrompt:extraPrompt,timestamp:Date.now(),label};
    pushToHistory(entry);setHistory(loadHistory());
    onApply({imageUrl,settings,resolvedExtraPrompt:extraPrompt});
  };
  const checkConflictAndApply=(imageUrl:string,settings:TemplateSettings,label:string)=>{
    if(settings.extraPrompt&&currentExtraPrompt.trim())setConflictPending({imageUrl,settings,label});
    else finalizeApply(imageUrl,settings,settings.extraPrompt??null,label);
  };
  const handleTemplateClick=(item:TemplateItem)=>{
    setAnalyzeError(null);
    setGeminiPending({imageUrl:`/templates/${item.filename}`,existingSettings:item.settings,label:item.label});
  };
  const handleUploadOwn=(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=(ev)=>{const dataUrl=ev.target?.result as string;setAnalyzeError(null);setGeminiPending({imageUrl:dataUrl,existingSettings:null,label:'自訂圖片'});};
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
    const apiKey=localStorage.getItem('vertexApiKey')||localStorage.getItem('geminiApiKey')||'';
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
      const bearerToken=await getValidBearerToken();
      const url=bearerToken
        ?`https://aiplatform.googleapis.com/v1/projects/${localStorage.getItem('gcpProjectId')||''}/locations/${localStorage.getItem('vertexRegion')||'us-central1'}/publishers/google/models/${ANALYSIS_MODEL}:generateContent`
        :`https://aiplatform.googleapis.com/v1beta1/publishers/google/models/${ANALYSIS_MODEL}:generateContent?key=${apiKey}`;
      const headers:Record<string,string>={'Content-Type':'application/json'};
      if(bearerToken)headers['Authorization']=`Bearer ${bearerToken}`;
      const body={contents:[{parts:[{inlineData:{mimeType,data:base64}},{text:prompt}]}]};
      const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
      if(!res.ok){const t=await res.text();throw new Error(`Gemini API 錯誤 ${res.status}: ${t.slice(0,200)}`);}
      const json=await res.json();
      const raw=json?.candidates?.[0]?.content?.parts?.[0]?.text??'{}';
      const geminiSettings:TemplateSettings=JSON.parse(raw.replace(/```json|```/g,'').trim());
      const merged:TemplateSettings=existingSettings?{...geminiSettings,...existingSettings}:geminiSettings;
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
    if(entry.resolvedExtraPrompt&&currentExtraPrompt.trim()){
      const fs:TemplateSettings={...(entry.settings||{}),extraPrompt:entry.resolvedExtraPrompt};
      setConflictPending({imageUrl:entry.imageUrl,settings:fs,label:entry.label});
    }else finalizeApply(entry.imageUrl,entry.settings,entry.resolvedExtraPrompt,entry.label);
  };
  const toggleStar=(filename:string,e:React.MouseEvent)=>{
    e.stopPropagation();const next=new Set(starred);
    if(next.has(filename))next.delete(filename);else next.add(filename);
    setStarred(next);saveStarred(next);
  };

  const renderTemplateCard=(item:TemplateItem)=>{
    const imgUrl=`/templates/${item.filename}`;
    const isStarred=starred.has(item.filename);
    const isHovered=hoveredCard===item.filename;
    return(
      <div key={item.filename} style={{position:'relative',display:'inline-block',width:'100%',marginBottom:'0.75rem',breakInside:'avoid'}}
        onMouseEnter={()=>setHoveredCard(item.filename)} onMouseLeave={()=>setHoveredCard(null)}>
        <button onClick={()=>handleTemplateClick(item)}
          style={{padding:0,border:`2px solid ${isHovered?'var(--accent-color)':'var(--border-color)'}`,borderRadius:'0.6rem',cursor:'pointer',background:'none',overflow:'hidden',display:'flex',flexDirection:'column',textAlign:'left',width:'100%',transition:'border-color 0.15s'}}>
          <img src={imgUrl} alt={item.label} style={{width:'100%',height:'auto',display:'block'}}/>
          <div style={{padding:'0.35rem 0.5rem',fontSize:'0.7rem',color:'var(--text-secondary)',background:'var(--bg-secondary)',width:'100%',boxSizing:'border-box'}}>
            <span style={{fontWeight:700,color:'var(--text-primary)'}}>{item.label}</span>
            {item.settings
              ?<span style={{marginLeft:'0.3rem'}}>{item.settings.fontFamily} · {item.settings.highlightColor}</span>
              :<span style={{marginLeft:'0.3rem',color:'var(--accent-color)',fontStyle:'italic'}}><Sparkles size={9} style={{verticalAlign:'middle'}}/> AI 分析</span>}
          </div>
        </button>
        {(isHovered||isStarred)&&(
          <button onClick={(e)=>toggleStar(item.filename,e)}
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

  const starredItems=ALL_TEMPLATES.filter(t=>starred.has(t.filename));
  const tabItems=tab==='all'?ALL_TEMPLATES:starredItems;

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
                  {t==='all'?`範本 (${ALL_TEMPLATES.length})`:t==='starred'?<><Star size={11} style={{verticalAlign:'middle',marginRight:'0.2rem'}}/>收藏 ({starredItems.length})</>:<><Clock size={11} style={{verticalAlign:'middle',marginRight:'0.2rem'}}/>歷史 ({history.length})</>}
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

        {/* Grid */}
        <div style={{overflowY:'auto',padding:'1rem 1.25rem',columnCount:3,columnGap:'0.75rem'}}>
          {tab==='history'
            ?(history.length>0?history.map(renderHistoryCard):<p style={{color:'var(--text-secondary)',fontSize:'0.85rem'}}>尚無歷史記錄</p>)
            :(tabItems.length>0?tabItems.map(renderTemplateCard):<p style={{color:'var(--text-secondary)',fontSize:'0.85rem'}}>尚無收藏</p>)}
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
