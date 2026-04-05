import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db, storage } from '../firebase';
import {
  collection, addDoc, getDocs, updateDoc, doc, orderBy, query, Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  MessageSquarePlus, Send, Star, ImagePlus, X, Loader, ChevronDown, ChevronUp,
  MessageCircle, ZoomIn
} from 'lucide-react';

// ── Types ──
interface FeedbackComment {
  id: string;
  text: string;
  nickname: string;
  createdAt: number;
}

interface FeedbackEntry {
  id: string;
  content: string;
  images: string[];
  nickname: string;
  createdAt: number;
  ratings: Record<string, number>; // anonId → 1-5
  comments: FeedbackComment[];
}

// ── Anonymous ID (persistent per browser) ──
const getAnonId = (): string => {
  let id = localStorage.getItem('feedback_anon_id');
  if (!id) {
    id = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('feedback_anon_id', id);
  }
  return id;
};

// ── Helpers ──
const timeAgo = (ts: number): string => {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(ts).toLocaleDateString('zh-TW');
};

const avgRating = (ratings: Record<string, number>): number => {
  const vals = Object.values(ratings);
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};

// ── Star Rating Component ──
const StarRating: React.FC<{ value: number; onChange?: (v: number) => void; size?: number; readOnly?: boolean }> = ({ value, onChange, size = 18, readOnly = false }) => {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'inline-flex', gap: '2px' }}>
      {[1, 2, 3, 4, 5].map(s => (
        <Star
          key={s}
          size={size}
          fill={(hover || value) >= s ? '#f59e0b' : 'none'}
          stroke={(hover || value) >= s ? '#f59e0b' : 'var(--text-secondary)'}
          strokeWidth={1.5}
          style={{ cursor: readOnly ? 'default' : 'pointer', transition: 'all 0.15s' }}
          onMouseEnter={() => !readOnly && setHover(s)}
          onMouseLeave={() => !readOnly && setHover(0)}
          onClick={() => !readOnly && onChange?.(s)}
        />
      ))}
    </div>
  );
};

// ── Single Feedback Card ──
const FeedbackCard: React.FC<{ entry: FeedbackEntry; anonId: string; onUpdate: () => void }> = ({ entry, anonId, onUpdate }) => {
  const [showComments, setShowComments] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentNick, setCommentNick] = useState(localStorage.getItem('feedback_nick') || '');
  const [submitting, setSubmitting] = useState(false);
  const [lightboxImg, setLightboxImg] = useState<string | null>(null);
  const myRating = entry.ratings[anonId] || 0;
  const avg = avgRating(entry.ratings);
  const ratingCount = Object.keys(entry.ratings).length;

  const handleRate = async (val: number) => {
    const newRatings = { ...entry.ratings, [anonId]: val };
    await updateDoc(doc(db, 'feedback', entry.id), { ratings: newRatings });
    onUpdate();
  };

  const handleComment = async () => {
    if (!commentText.trim()) return;
    setSubmitting(true);
    const nick = commentNick.trim() || '匿名';
    if (commentNick.trim()) localStorage.setItem('feedback_nick', commentNick.trim());
    try {
      await addDoc(collection(db, 'feedback', entry.id, 'comments'), {
        text: commentText.trim(),
        nickname: nick,
        createdAt: Date.now(),
      });
      setCommentText('');
      onUpdate();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border-color)', borderRadius: '0.6rem',
      backgroundColor: 'var(--bg-primary)', overflow: 'hidden',
      transition: 'box-shadow 0.2s',
    }}>
      {/* Header */}
      <div style={{ padding: '0.8rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: entry.images.length > 0 ? '1px solid var(--border-color)' : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-color), #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: '0.7rem', fontWeight: 700, flexShrink: 0,
          }}>
            {(entry.nickname || '匿')[0]}
          </div>
          <div>
            <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{entry.nickname || '匿名'}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', marginLeft: '0.5rem' }}>{timeAgo(entry.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* Images */}
      {entry.images.length > 0 && (
        <div style={{
          display: 'flex', gap: '0.4rem', padding: '0.6rem 1rem',
          overflowX: 'auto', borderBottom: '1px solid var(--border-color)',
        }}>
          {entry.images.map((img, i) => (
            <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
              <img
                src={img} alt={`附圖 ${i + 1}`}
                onClick={() => setLightboxImg(img)}
                style={{
                  height: '120px', borderRadius: '0.4rem', cursor: 'pointer',
                  border: '1px solid var(--border-color)', objectFit: 'cover',
                }}
              />
              <div
                onClick={() => setLightboxImg(img)}
                style={{
                  position: 'absolute', bottom: '4px', right: '4px',
                  background: 'rgba(0,0,0,0.5)', borderRadius: '50%', padding: '3px',
                  cursor: 'pointer', display: 'flex',
                }}>
                <ZoomIn size={12} color="#fff" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: '0.8rem 1rem', fontSize: '0.88rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {entry.content}
      </div>

      {/* Rating + Comment toggle */}
      <div style={{
        padding: '0.5rem 1rem 0.6rem', borderTop: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <StarRating value={myRating} onChange={handleRate} size={16} />
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            {ratingCount > 0 ? `${avg.toFixed(1)} 分（${ratingCount} 人評分）` : '尚無評分'}
          </span>
        </div>
        <button
          onClick={() => setShowComments(!showComments)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.3rem',
            fontSize: '0.75rem', color: 'var(--text-secondary)', padding: '0.2rem 0.4rem',
            borderRadius: '0.25rem',
          }}
        >
          <MessageCircle size={13} />
          {entry.comments.length > 0 ? `${entry.comments.length} 則留言` : '留言'}
          {showComments ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
      </div>

      {/* Comments section */}
      {showComments && (
        <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.6rem 1rem', background: 'var(--bg-secondary)' }}>
          {entry.comments.length === 0 && (
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', margin: '0.3rem 0' }}>暫無留言，成為第一個留言的人吧！</p>
          )}
          {entry.comments.map(c => (
            <div key={c.id} style={{ marginBottom: '0.5rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>{c.nickname}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>{timeAgo(c.createdAt)}</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', lineHeight: 1.5 }}>{c.text}</p>
            </div>
          ))}
          {/* Add comment */}
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem', alignItems: 'flex-end' }}>
            <input
              value={commentNick}
              onChange={e => setCommentNick(e.target.value)}
              placeholder="暱稱（選填）"
              style={{
                width: '80px', padding: '0.35rem 0.5rem', fontSize: '0.75rem',
                border: '1px solid var(--border-color)', borderRadius: '0.3rem',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
              }}
            />
            <input
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              placeholder="輸入留言…"
              onKeyDown={e => e.key === 'Enter' && !submitting && handleComment()}
              style={{
                flex: 1, padding: '0.35rem 0.5rem', fontSize: '0.75rem',
                border: '1px solid var(--border-color)', borderRadius: '0.3rem',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
              }}
            />
            <button
              onClick={handleComment}
              disabled={submitting || !commentText.trim()}
              style={{
                background: 'var(--accent-color)', color: '#fff', border: 'none',
                borderRadius: '0.3rem', padding: '0.35rem 0.6rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem',
                opacity: submitting || !commentText.trim() ? 0.5 : 1,
              }}
            >
              <Send size={12} /> 送出
            </button>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxImg && (
        <div
          onClick={() => setLightboxImg(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            backgroundColor: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem',
          }}
        >
          <button onClick={() => setLightboxImg(null)} style={{
            position: 'absolute', top: '1rem', right: '1rem',
            background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%',
            width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#fff',
          }}>
            <X size={18} />
          </button>
          <img src={lightboxImg} alt="放大圖" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: '0.5rem', boxShadow: '0 16px 48px rgba(0,0,0,0.5)' }} />
        </div>
      )}
    </div>
  );
};

// ── Main Feedback Page ──
export const Feedback: React.FC = () => {
  const anonId = useRef(getAnonId()).current;
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // New post form state
  const [content, setContent] = useState('');
  const [nickname, setNickname] = useState(localStorage.getItem('feedback_nick') || '');
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch feedback + comments ──
  const fetchAll = useCallback(async () => {
    const q = query(collection(db, 'feedback'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const results: FeedbackEntry[] = [];
    for (const d of snap.docs) {
      const data = d.data();
      // Fetch comments subcollection
      const commSnap = await getDocs(query(collection(db, 'feedback', d.id, 'comments'), orderBy('createdAt', 'asc')));
      const comments: FeedbackComment[] = commSnap.docs.map(c => ({ id: c.id, ...c.data() } as FeedbackComment));
      results.push({
        id: d.id,
        content: data.content || '',
        images: data.images || [],
        nickname: data.nickname || '匿名',
        createdAt: data.createdAt?.toMillis?.() || data.createdAt || Date.now(),
        ratings: data.ratings || {},
        comments,
      });
    }
    setEntries(results);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Image selection ──
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = 10 - imageFiles.length;
    const toAdd = files.slice(0, remaining);
    setImageFiles(prev => [...prev, ...toAdd]);
    // Generate previews
    toAdd.forEach(f => {
      const reader = new FileReader();
      reader.onload = () => setImagePreviews(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(f);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeImage = (idx: number) => {
    setImageFiles(prev => prev.filter((_, i) => i !== idx));
    setImagePreviews(prev => prev.filter((_, i) => i !== idx));
  };

  // ── Submit feedback ──
  const handleSubmit = async () => {
    if (!content.trim()) return;
    setPosting(true);
    try {
      // Upload images
      const imageUrls: string[] = [];
      for (const file of imageFiles) {
        const storageRef = ref(storage, `feedback/${Date.now()}_${Math.random().toString(36).slice(2)}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        imageUrls.push(url);
      }
      const nick = nickname.trim() || '匿名';
      if (nickname.trim()) localStorage.setItem('feedback_nick', nickname.trim());
      await addDoc(collection(db, 'feedback'), {
        content: content.trim(),
        images: imageUrls,
        nickname: nick,
        createdAt: Timestamp.now(),
        ratings: {},
      });
      setContent('');
      setImageFiles([]);
      setImagePreviews([]);
      setShowForm(false);
      await fetchAll();
    } catch (err: any) {
      console.error('Feedback submit error:', err);
      alert('提交失敗：' + (err.message || '未知錯誤'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '2rem', maxWidth: '720px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <MessageSquarePlus size={22} style={{ color: 'var(--accent-color)' }} />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>意見回饋</h1>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          style={{
            background: 'var(--accent-color)', color: '#fff', border: 'none',
            borderRadius: '0.4rem', padding: '0.45rem 1rem', cursor: 'pointer',
            fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem',
          }}
        >
          <MessageSquarePlus size={14} /> {showForm ? '收起' : '新增回饋'}
        </button>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
        匿名回饋平台 — 分享你的使用心得、遇到的問題或建議。所有人都可以查看、評分與留言。
      </p>

      {/* New Feedback Form */}
      {showForm && (
        <div style={{
          border: '1px solid var(--accent-color)', borderRadius: '0.6rem',
          padding: '1rem', marginBottom: '1.5rem', backgroundColor: 'var(--bg-secondary)',
        }}>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <input
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="暱稱（選填，預設為「匿名」）"
              style={{
                flex: 1, padding: '0.45rem 0.6rem', fontSize: '0.82rem',
                border: '1px solid var(--border-color)', borderRadius: '0.35rem',
                background: 'var(--bg-primary)', color: 'var(--text-primary)',
              }}
            />
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="請描述你遇到的問題、建議或使用心得…"
            rows={4}
            style={{
              width: '100%', padding: '0.6rem', fontSize: '0.85rem',
              border: '1px solid var(--border-color)', borderRadius: '0.35rem',
              background: 'var(--bg-primary)', color: 'var(--text-primary)',
              resize: 'vertical', lineHeight: 1.6, boxSizing: 'border-box',
            }}
          />

          {/* Image previews */}
          {imagePreviews.length > 0 && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              {imagePreviews.map((src, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={src} alt={`預覽 ${i + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '0.3rem', border: '1px solid var(--border-color)' }} />
                  <button
                    onClick={() => removeImage(i)}
                    style={{
                      position: 'absolute', top: '-6px', right: '-6px',
                      background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%',
                      width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', padding: 0,
                    }}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input type="file" ref={fileInputRef} accept="image/*" multiple onChange={handleImageSelect} style={{ display: 'none' }} />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={imageFiles.length >= 10}
                style={{
                  background: 'none', border: '1px solid var(--border-color)', borderRadius: '0.3rem',
                  padding: '0.3rem 0.6rem', cursor: imageFiles.length >= 10 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem',
                  color: 'var(--text-secondary)', opacity: imageFiles.length >= 10 ? 0.5 : 1,
                }}
              >
                <ImagePlus size={13} /> 附圖 ({imageFiles.length}/10)
              </button>
            </div>
            <button
              onClick={handleSubmit}
              disabled={posting || !content.trim()}
              style={{
                background: 'var(--accent-color)', color: '#fff', border: 'none',
                borderRadius: '0.35rem', padding: '0.4rem 1.2rem', cursor: 'pointer',
                fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem',
                opacity: posting || !content.trim() ? 0.5 : 1,
              }}
            >
              {posting ? <><Loader size={13} style={{ animation: 'spin 1s linear infinite' }} /> 提交中…</> : <><Send size={13} /> 提交</>}
            </button>
          </div>
        </div>
      )}

      {/* Entries list */}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: 'var(--text-secondary)', gap: '0.5rem' }}>
          <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> 載入中…
        </div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          <MessageSquarePlus size={40} style={{ opacity: 0.3, marginBottom: '0.8rem' }} />
          <p style={{ fontSize: '0.9rem' }}>目前還沒有回饋，成為第一個發言的人吧！</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {entries.map(entry => (
            <FeedbackCard key={entry.id} entry={entry} anonId={anonId} onUpdate={fetchAll} />
          ))}
        </div>
      )}
    </div>
  );
};
