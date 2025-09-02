import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  User, 
  LogOut, 
  Settings, 
  ChevronDown,
  Menu,
  X
} from 'lucide-react';
import './Header.css';

const Header = ({ onMenuToggle, isSidebarOpen }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isProfileClosing, setIsProfileClosing] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const profileRef = useRef(null);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        handleProfileClose();
      }
    };

    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileMenuOpen]);

  const handleLogout = () => {
    logout();
    navigate('/');
    handleProfileClose();
  };

  const handleProfileClick = () => {
    if (isProfileMenuOpen) {
      handleProfileClose();
    } else {
      setIsProfileMenuOpen(true);
      setIsProfileClosing(false);
    }
  };

  const handleProfileClose = () => {
    setIsProfileClosing(true);
    setTimeout(() => {
      setIsProfileMenuOpen(false);
      setIsProfileClosing(false);
    }, 300); // Match the CSS transition duration
  };

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
    if (onMenuToggle) {
      onMenuToggle();
    }
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <header className="header">
      <div className="header-content">
        {/* Left side - Logo and Menu Toggle */}
        <div className="header-left">
          <button 
            className="menu-toggle"
            onClick={handleMobileMenuToggle}
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          
          <div className="logo" onClick={() => navigate('/')}>
            <h1 className="logo-text">Intellimark</h1>
          </div>
        </div>

        {/* Center - Navigation */}
        <nav className="header-nav">
          {user?.isAdmin && (
            <button 
              className="nav-item admin-nav"
              onClick={() => navigate('/admin')}
            >
              Admin
            </button>
          )}
        </nav>

        {/* Right side - Profile */}
        <div className="header-right">
          {user ? (
            <div className="profile-section" ref={profileRef}>
              <button 
                className="profile-button"
                onClick={handleProfileClick}
                aria-label="Profile menu"
              >
                <div className="profile-avatar">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Profile" />
                  ) : (
                    <User size={20} />
                  )}
                </div>
                <span className="profile-name">
                  {user.displayName || user.email?.split('@')[0] || 'User'}
                </span>
                <ChevronDown size={16} className={`chevron ${isProfileMenuOpen ? 'rotated' : ''}`} />
              </button>

              {/* Profile Dropdown */}
              {isProfileMenuOpen && (
                <div className={`profile-dropdown ${isProfileClosing ? 'closing' : ''}`}>
                  <div className="profile-info">
                    <div className="profile-avatar large">
                      {user.photoURL ? (
                        <img src={user.photoURL} alt="Profile" />
                      ) : (
                        <User size={24} />
                      )}
                    </div>
                    <div className="profile-details">
                      <div className="profile-name-large">
                        {user.displayName || 'User'}
                      </div>
                      <div className="profile-email">
                        {user.email}
                      </div>
                      {user.isAdmin && (
                        <div className="admin-badge">Admin</div>
                      )}
                    </div>
                  </div>
                  
                  <div className="profile-actions">
                    <button 
                      className="profile-action"
                      onClick={() => {
                        navigate('/profile');
                        handleProfileClose();
                      }}
                    >
                      <Settings size={16} />
                      Settings
                    </button>
                    <button 
                      className="profile-action logout"
                      onClick={handleLogout}
                    >
                      <LogOut size={16} />
                      Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <button 
              className="login-button"
              onClick={() => navigate('/login')}
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Mobile Navigation Menu */}
      {isMobileMenuOpen && (
        <div className="mobile-nav">
          {user?.isAdmin && (
            <button 
              className="mobile-nav-item admin-nav"
              onClick={() => {
                navigate('/admin');
                closeMobileMenu();
              }}
            >
              Admin
            </button>
          )}
        </div>
      )}
    </header>
  );
};

export default Header;
