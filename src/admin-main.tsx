import React from 'react';
import {createRoot} from 'react-dom/client';
import AdminApp from './AdminApp';
import {installFormKeys} from './inputKeys';
installFormKeys();
import './style.css';
import './capabilities.css';
import './admin.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminApp/></React.StrictMode>);
