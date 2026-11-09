import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#0B0C10] text-white">
      <div className="text-center">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-indigo-400 bg-clip-text text-transparent">
          SmoothStudio Editor
        </h1>
        <p className="mt-2 text-sm text-gray-400">Loading Studio Workspace & Rendering Engine...</p>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(<App />);
}
