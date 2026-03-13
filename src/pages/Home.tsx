import React, { useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Plus, LayoutTemplate, Trash2, Edit2, Presentation, BookOpen, FileText, BarChart3, PieChart, Target, Lightbulb, Rocket, Globe, Briefcase } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, deleteDoc, doc, updateDoc, onSnapshot, query, where } from 'firebase/firestore';
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

  // Auth Listener
  React.useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserId(user.uid);
      } else {
        setUserId(null);
        navigate('/'); // Redirect to landing if not logged in
      }
    });
    return () => unsubAuth();
  }, [navigate]);

  // Fetch Projects from Firestore
  React.useEffect(() => {
    if (!userId) return; // Wait until we know the user
    
    const q = query(
      collection(db, 'projects'), 
      where('userId', '==', userId)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
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
    });
    return () => unsubscribe();
  }, [userId]);

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
    if (!window.confirm("Are you sure you want to delete this project?")) return;
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
        <label className="input-label">Icon</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
          {ICON_OPTIONS.map(opt => {
            const IconComp = opt.icon;
            return (
              <div
                key={opt.name}
                onClick={() => onIconChange(opt.name)}
                style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  backgroundColor: selectedIcon === opt.name ? `${selectedColor}20` : 'var(--bg-secondary)',
                  border: selectedIcon === opt.name ? `2px solid ${selectedColor}` : '2px solid transparent',
                  color: selectedIcon === opt.name ? selectedColor : 'var(--text-secondary)',
                  transition: 'all 0.15s ease'
                }}
              >
                <IconComp size={20} />
              </div>
            );
          })}
        </div>
      </div>
      <div>
        <label className="input-label">Color</label>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
          {COLOR_OPTIONS.map(color => (
            <div 
              key={color}
              onClick={() => onColorChange(color)}
              style={{ 
                width: '32px', height: '32px', borderRadius: '50%', backgroundColor: color, 
                cursor: 'pointer', border: selectedColor === color ? '2px solid var(--text-primary)' : '2px solid transparent',
                boxShadow: selectedColor === color ? '0 0 0 2px var(--bg-primary) inset' : 'none',
                transition: 'transform 0.15s ease',
                transform: selectedColor === color ? 'scale(1.15)' : 'scale(1)'
              }}
            />
          ))}
        </div>
      </div>
    </>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Your Projects</h1>
          <p>Manage and design your presentations</p>
        </div>
        <Button icon={Plus} onClick={() => setIsModalOpen(true)}>New Project</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
        {projects.map((project) => {
          const ProjectIcon = getIconComponent(project.icon);
          return (
            <Card 
              key={project.id} 
              style={{ cursor: 'pointer', position: 'relative' }} 
              onClick={() => navigate(`/project/${project.id}`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3rem' }}>
                <div style={{ 
                  width: '48px', height: '48px', borderRadius: '12px', 
                  backgroundColor: `${project.color}20`, color: project.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <ProjectIcon size={24} />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button variant="ghost" size="sm" style={{ padding: '0.25rem', color: 'var(--text-secondary)' }} onClick={(e) => startEdit(e, project)}>
                    <Edit2 size={18} />
                  </Button>
                  <Button variant="ghost" size="sm" style={{ padding: '0.25rem', color: '#ef4444' }} onClick={(e) => handleDelete(e, project.id)}>
                    <Trash2 size={18} />
                  </Button>
                </div>
              </div>

              <h3 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{project.name}</h3>
              <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>Edited {project.date}</p>
            </Card>
          );
        })}
      </div>

      {/* Create New Project Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Project">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <Input 
            label="Project Name" 
            placeholder="e.g. Q4 Business Review" 
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            autoFocus
          />
          {renderIconColorPicker(newProjectIcon, setNewProjectIcon, newProjectColor, setNewProjectColor)}
          <Button fullWidth onClick={handleCreateProject} style={{ marginTop: '1rem' }}>Create Project</Button>
        </div>
      </Modal>

      {/* Edit Project Modal */}
      <Modal isOpen={editModalOpen} onClose={() => { setEditModalOpen(false); setEditingProject(null); }} title="Edit Project">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <Input 
            label="Project Name" 
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            autoFocus
          />
          {renderIconColorPicker(editIcon, setEditIcon, editColor, setEditColor)}
          <Button fullWidth onClick={saveEdit} style={{ marginTop: '1rem' }}>Save Changes</Button>
        </div>
      </Modal>
    </div>
  );
};
