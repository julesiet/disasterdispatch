import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import DriverRegistrationPage from './pages/DriverRegistrationPage';
import DriverViewPage from './pages/DriverViewPage';
import HeatmapPage from './pages/HeatmapPage';
import AdminDebugPage from './pages/AdminDebugPage';
import ResidentRegistrationPage from './pages/ResidentRegistrationPage';
import './styles.css';

const navItems = [
  { to: '/', label: 'Live map', end: true },
  { to: '/driver', label: 'Driver view' },
  { to: '/admin', label: 'Admin debug' },
];

export default function App() {
  return (
    <BrowserRouter>
      <header className="console-header">
        <NavLink className="console-brand" to="/" aria-label="DisasterDispatch home">
          DisasterDispatch
        </NavLink>
        <div className="console-header__right">
          <nav className="console-nav" aria-label="Main navigation">
            {navItems.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end === true}
                className={({ isActive }) => `console-nav__link${isActive ? ' is-active' : ''}`}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <span className="console-live-status">
            <span aria-hidden="true" /> Live zone feed
          </span>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<HeatmapPage />} />
        <Route path="/driver" element={<DriverViewPage />} />
        <Route path="/admin" element={<AdminDebugPage />} />
        <Route path="/register/resident" element={<ResidentRegistrationPage />} />
        <Route path="/register/driver" element={<DriverRegistrationPage />} />
      </Routes>
    </BrowserRouter>
  );
}
