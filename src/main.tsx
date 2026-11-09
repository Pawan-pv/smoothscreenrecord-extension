import React from 'react';
import ReactDOM from 'react-dom/client';
import { EditorStudio } from './editor/EditorStudio';
import './index.css';

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<EditorStudio />);
}
