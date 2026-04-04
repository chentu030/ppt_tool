import React, { useState } from 'react';
import { showAlert, showConfirm } from '../utils/dialog';
import { Plus, LayoutTemplate, Trash2, Edit2, Presentation, BookOpen, FileText, BarChart3, PieChart, Target, Lightbulb, Rocket, Globe, Briefcase, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';

// Available icons for project cards
const ICON_OPTIONS = [
  { name: 'LayoutTemplate', icon: LayoutTemplate },
  { name: 'Presentation', icon: Presentation },
  { name: 'BookOpen', icon: BookOpen },
  { name: 'FileText', icon: FileText },
  { name: 'BarChart3', icon: BarChart3 },
  { name: 'PieChart', icon: PieChart },
  { name: 'Target', icon: Target },
  { name: 'Lightbulb', icon: Lightbulb },
  { name: 'Rocket', icon: Rocket },
  { name: 'Globe', icon: Globe },
  { name: 'Briefcase', icon: Briefcase },
];

const COLOR_OPTIONS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const getIconComponent = (iconName: string | undefined) => {
  const found = ICON_OPTIONS.find(opt => opt.name === iconName);
  return found ? found.icon : LayoutTemplate;
};

interface Project {
  id: string;
  name: string;
  date: string;
  color: string;
  icon?: string;
  createdAt?: number;
}

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const navigateRef = React.useRef(navigate);
  React.useEffect(() => { navigateRef.current = navigate; });
  const [projects, setProjects] = useState<Project[]>([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState('#3b82f6');
  const [newProjectIcon, setNewProjectIcon] = useState('LayoutTemplate');

  // Edit State
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('#3b82f6');
  const [editIcon, setEditIcon] = useState('LayoutTemplate');
  
  // Current User
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Slide thumbnails per project: projectId -> [imageUrl, imageUrl]
  const [projectThumbs, setProjectThumbs] = useState<Record<string, (string | null)[]>>({});

  // Auth Listener — empty deps so it only subscribes ONCE (navigate is stable via ref)
  React.useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setAuthLoading(false);
      if (user) {
        setUserId(user.uid);
      } else {
        setUserId(null);
        navigateRef.current('/'); // Redirect to landing if not logged in
      }
    });
    return () => unsubAuth();
  }, []);

  // Fetch Projects from Firestore
  React.useEffect(() => {
    if (!userId) return; // Wait until we know the user
    console.log('[Home] Fetching projects for userId:', userId);
    
    const q = query(
      collection(db, 'projects'), 
      where('userId', '==', userId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log('[Home] Firestore snapshot received, docs:', snapshot.docs.length);
      const projData: Project[] = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        date: doc.data().date,
        color: doc.data().color,
        icon: doc.data().icon || 'LayoutTemplate',
        createdAt: doc.data().createdAt || 0
      })) as (Project & { createdAt: number })[];
      
      // Sort locally by creation date (descending)
      projData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      
      setProjects(projData);
    }, (error) => {
      console.error('[Home] Firestore error:', error.code, error.message);
      showAlert(`Firestore 發生錯誤：${error.code}\n${error.message}`, '錯誤');
    });
    return () => unsubscribe();
  }, [userId]);

  // Fetch first 2 slide thumbnails for each project
  React.useEffect(() => {
    if (projects.length === 0) return;
    const fetchThumbs = async () => {
      const thumbs: Record<string, (string | null)[]> = {};
      await Promise.all(projects.map(async (proj) => {
        try {
          const slidesQ = query(
            collection(db, 'projects', proj.id, 'slides'),
            orderBy('order', 'asc'),
            limit(2)
          );
          const snap = await getDocs(slidesQ);
          const imgs = snap.docs.map(d => {
            const data = d.data();
            return data.generatedImage || data.originalImage || null;
          });
          thumbs[proj.id] = imgs;
        } catch {
          thumbs[proj.id] = [];
        }
      }));
      setProjectThumbs(thumbs);
    };
    fetchThumbs();
  }, [projects]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !userId) return;
    try {
      await addDoc(collection(db, 'projects'), {
        name: newProjectName,
        date: new Date().toLocaleDateString(),
        color: newProjectColor,
        icon: newProjectIcon,
        createdAt: new Date().getTime(),
        userId: userId
      });
      setIsModalOpen(false);
      setNewProjectName('');
      setNewProjectColor('#3b82f6');
      setNewProjectIcon('LayoutTemplate');
    } catch (e) {
      console.error("Error adding document: ", e);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!await showConfirm('確定要刪除這個專案嗎？此操作無法復原。', '刪除專案', '刪除', '取消')) return;
    try {
      await deleteDoc(doc(db, 'projects', id));
    } catch (e) {
      console.error("Error deleting document: ", e);
    }
  };

  const startEdit = (e: React.MouseEvent, proj: Project) => {
    e.stopPropagation();
    setEditingProject(proj);
    setEditName(proj.name);
    setEditColor(proj.color);
    setEditIcon(proj.icon || 'LayoutTemplate');
    setEditModalOpen(true);
  };

  const saveEdit = async () => {
    if (!editingProject || !editName.trim()) return;
    try {
      await updateDoc(doc(db, 'projects', editingProject.id), { 
        name: editName,
        color: editColor,
        icon: editIcon
      });
    } catch (err) {
      console.error("Error updating document: ", err);
    }
    setEditModalOpen(false);
    setEditingProject(null);
  };

  // Shared icon/color picker component
  const renderIconColorPicker = (
    selectedIcon: string, 
    onIconChange: (name: string) => void, 
    selectedColor: string, 
    onColorChange: (color: string) => void
  ) => (
    <>
      <div>
        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>圖示</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
          {ICON_OPTIONS.map(opt => {
            const IconComp = opt.icon;
            return (
              <div
                key={opt.name}
                onClick={() => onIconChange(opt.name)}
                style={{
                  width: '30px', height: '30px', borderRadius: '0.25rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  backgroundColor: selectedIcon === opt.name ? `${selectedColor}18` : 'var(--bg-secondary)',
                  border: selectedIcon === opt.name ? `1.5px solid ${selectedColor}` : '1.5px solid transparent',
                  color: selectedIcon === opt.name ? selectedColor : 'var(--text-secondary)',
                  transition: 'all 0.15s ease'
                }}
              >
                <IconComp size={14} />
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>顏色</label>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {COLOR_OPTIONS.map(color => (
            <div 
              key={color}
              onClick={() => onColorChange(color)}
              style={{ 
                width: '24px', height: '24px', borderRadius: '50%', backgroundColor: color, 
                cursor: 'pointer', border: selectedColor === color ? '2px solid var(--text-primary)' : '2px solid transparent',
                boxShadow: selectedColor === color ? '0 0 0 1.5px var(--bg-primary) inset' : 'none',
                transition: 'transform 0.15s ease',
                transform: selectedColor === color ? 'scale(1.1)' : 'scale(1)'
              }}
            />
          ))}
        </div>
      </div>
    </>
  );

  if (authLoading) return null; // Wait for auth state to resolve before rendering or redirecting

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '0.5rem 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.15rem', color: 'var(--text-primary)' }}>專案列表</h1>
          <p style={{ fontSize: '0.75rem', margin: 0 }}>管理與設計你的簡報</p>
        </div>
        <button onClick={() => setIsModalOpen(true)}
          style={{ padding: '0.4rem 0.8rem', fontSize: '0.78rem', fontWeight: 600, border: 'none', borderRadius: '0.35rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Plus size={14} /> 新增專案
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
        {projects.map((project) => {
          const ProjectIcon = getIconComponent(project.icon);
          return (
            <div
              key={project.id}
              style={{ cursor: 'pointer', position: 'relative', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.85rem 1rem', transition: 'box-shadow 0.2s, border-color 0.2s' }}
              onClick={() => navigate(`/project/${project.id}`)}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--text-secondary)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-color)'; (e.currentTarget as HTMLDivElement).style.boxShadow = 'none'; }}
            >
              {/* Slide thumbnails */}
              <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.6rem' }}>
                {[0, 1].map(i => {
                  const thumbs = projectThumbs[project.id] || [];
                  const src = thumbs[i] || null;
                  return (
                    <div key={i} style={{ flex: 1, aspectRatio: '16/9', borderRadius: '0.3rem', overflow: 'hidden', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
                      {src ? (
                        <img src={src} alt={`Slide ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', backgroundColor: '#fff' }} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '0.35rem',
                  backgroundColor: `${project.color}18`, color: project.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <ProjectIcon size={16} />
                </div>
                <div style={{ display: 'flex', gap: '0.2rem' }}>
                  <button onClick={(e) => startEdit(e, project)} title="編輯" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', color: 'var(--text-secondary)', opacity: 0.5 }}><Edit2 size={13} /></button>
                  <button onClick={(e) => handleDelete(e, project.id)} title="刪除" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '3px', color: '#ef4444', opacity: 0.5 }}><Trash2 size={13} /></button>
                </div>
              </div>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{project.name}</div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)' }}>編輯於 {project.date}</div>
            </div>
          );
        })}
      </div>

      {/* Create New Project Modal */}
      {isModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setIsModalOpen(false)}>
          <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.6rem', padding: '1.25rem', width: '400px', maxWidth: '90vw', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: '1rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>新增專案</span>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)' }}><X size={15} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>專案名稱</label>
              <input value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="例如：Q4 營運報告" autoFocus
                style={{ width: '100%', padding: '0.45rem 0.6rem', fontSize: '0.82rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {renderIconColorPicker(newProjectIcon, setNewProjectIcon, newProjectColor, setNewProjectColor)}
            <button onClick={handleCreateProject}
              style={{ width: '100%', padding: '0.5rem', fontSize: '0.82rem', fontWeight: 600, border: 'none', borderRadius: '0.35rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff' }}>
              建立專案
            </button>
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {editModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => { setEditModalOpen(false); setEditingProject(null); }}>
          <div style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '0.6rem', padding: '1.25rem', width: '400px', maxWidth: '90vw', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column', gap: '1rem' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>編輯專案</span>
              <button onClick={() => { setEditModalOpen(false); setEditingProject(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-secondary)' }}><X size={15} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)' }}>專案名稱</label>
              <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus
                style={{ width: '100%', padding: '0.45rem 0.6rem', fontSize: '0.82rem', border: '1px solid var(--border-color)', borderRadius: '0.3rem', background: 'var(--bg-secondary)', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {renderIconColorPicker(editIcon, setEditIcon, editColor, setEditColor)}
            <button onClick={saveEdit}
              style={{ width: '100%', padding: '0.5rem', fontSize: '0.82rem', fontWeight: 600, border: 'none', borderRadius: '0.35rem', cursor: 'pointer', background: 'var(--accent-color)', color: '#fff' }}>
              儲存變更
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
