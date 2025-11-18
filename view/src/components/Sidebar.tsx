import './Sidebar.css';
import feather from 'feather-icons';
import { onMount } from 'solid-js';

const Sidebar = () => {
  onMount(() => {
    feather.replace();
  });

  return (
    <div class="sidebar">
      <div class="sidebar-content">
        <nav class="sidebar-nav">
          <div class="nav-item active">
            <div class="nav-icon">
              <i data-feather="map"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="layers"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="target"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="menu"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="grid"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="code"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="settings"></i>
            </div>
          </div>
          <div class="nav-item">
            <div class="nav-icon">
              <i data-feather="help-circle"></i>
            </div>
          </div>
        </nav>
      </div>
    </div>
  );
};

export default Sidebar;