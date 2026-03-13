import React from 'react';
import type { InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input: React.FC<InputProps> = ({ label, id, className = '', ...props }) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
  
  return (
    <div className={`input-container ${className}`}>
      {label && <label htmlFor={inputId} className="input-label">{label}</label>}
      <input id={inputId} className="input-field" {...props} />
    </div>
  );
};
