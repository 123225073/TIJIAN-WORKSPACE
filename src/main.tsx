import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import './style.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(e:Error){return {error:e.message}};render(){return this.state.error?<div className="fatal"><h1>页面遇到问题</h1><p>已保存的资料仍然保留。请重新打开页面。</p><button onClick={()=>location.reload()}>重新打开</button><details><summary>错误详情</summary>{this.state.error}</details></div>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);

import './work-pages.css';
