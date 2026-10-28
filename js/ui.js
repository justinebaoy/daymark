/**
 * Daymark - UI Module
 * Shared interface utilities: mobile navigation and non-blocking feedback.
 *
 * Notifications are visual only. A separate polite live region carries the
 * message for assistive technology so the visible toast never steals focus
 * and the same message is not announced twice.
 */

(function () {
  'use strict';

  const TOAST_DURATION = 5000;
  const TOAST_LEAVE_DURATION = 160;

  let toastRegion = null;
  let liveRegion = null;
  let currentToast = null;
  let toastTimer = 0;
  let removeTimer = 0;
  let lastAnnouncedMessage = '';
  let repeatAnnouncement = 0;

  /* ---------------------------------------------------------------------- */
  /* Notifications                                                          */
  /* ---------------------------------------------------------------------- */

  function ensureLiveRegion() {
    if (liveRegion) {
      return;
    }

    liveRegion = document.createElement('div');
    liveRegion.className = 'visually-hidden';
    liveRegion.id = 'daymarkLiveRegion';
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    document.body.appendChild(liveRegion);
  }

  function ensureFeedbackRegions() {
    ensureLiveRegion();

    if (!toastRegion) {
      toastRegion = document.createElement('div');
      toastRegion.className = 'toast-region';
      toastRegion.id = 'toastRegion';
      // The visible copy is decorative; screen readers get the live region.
      toastRegion.setAttribute('aria-hidden', 'true');
      document.body.appendChild(toastRegion);
    }
  }

  function announceForAssistiveTech(message) {
    if (!liveRegion) {
      return;
    }

    if (message === lastAnnouncedMessage) {
      // Alternate an invisible character so an identical repeat still
      // produces a fresh live-region mutation.
      repeatAnnouncement += 1;
      liveRegion.textContent = message + (repeatAnnouncement % 2 ? '\u200B' : '\u200C');
      return;
    }

    lastAnnouncedMessage = message;
    repeatAnnouncement = 0;
    liveRegion.textContent = message;
  }

  function clearToastTimers() {
    window.clearTimeout(toastTimer);
    window.clearTimeout(removeTimer);
  }

  function removeCurrentToast() {
    clearToastTimers();

    if (currentToast && currentToast.parentNode) {
      currentToast.parentNode.removeChild(currentToast);
    }

    currentToast = null;
  }

  function scheduleToastRemoval(toast, duration) {
    toastTimer = window.setTimeout(function () {
      if (currentToast !== toast) {
        return;
      }

      toast.classList.add('is-leaving');

      removeTimer = window.setTimeout(function () {
        if (currentToast === toast) {
          removeCurrentToast();
        }
      }, TOAST_LEAVE_DURATION);
    }, duration);
  }

  function buildToast(message, tone, duration) {
    const toast = document.createElement('div');
    const icon = document.createElement('span');
    const text = document.createElement('p');
    const dismiss = document.createElement('button');

    toast.className = 'toast toast-' + tone;

    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');

    text.className = 'toast-message';
    text.textContent = message;

    dismiss.className = 'toast-dismiss';
    dismiss.type = 'button';
    dismiss.textContent = '\u00D7';
    dismiss.title = 'Dismiss notification';
    // Keyboard and screen-reader users can ignore the toast; it clears on
    // its own and the live region has already announced the message.
    dismiss.tabIndex = -1;
    dismiss.setAttribute('aria-hidden', 'true');
    dismiss.addEventListener('click', removeCurrentToast);

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(dismiss);

    toast.addEventListener('mouseenter', function () {
      clearToastTimers();

      if (toast.classList.contains('is-leaving')) {
        toast.classList.remove('is-leaving');
      }
    });

    toast.addEventListener('mouseleave', function () {
      if (currentToast === toast) {
        scheduleToastRemoval(toast, duration);
      }
    });

    return toast;
  }

  /**
   * Show a short, non-blocking status message.
   *
   * @param {string} message Concise user-facing text.
   * @param {{tone?: 'success'|'error', duration?: number}} [options]
   */
  function notify(message, options) {
    if (!message) {
      return;
    }

    ensureFeedbackRegions();
    removeCurrentToast();

    const settings = options || {};
    const tone = settings.tone === 'error' ? 'error' : 'success';
    const duration = typeof settings.duration === 'number'
      ? settings.duration
      : TOAST_DURATION;

    announceForAssistiveTech(message);

    const toast = buildToast(message, tone, duration);
    currentToast = toast;
    toastRegion.appendChild(toast);
    scheduleToastRemoval(toast, duration);
  }

  /**
   * Removes the visible toast without announcing anything. Used when an
   * inline form error takes over so an older success message cannot look
   * like confirmation of the failed write.
   */
  function clearToast() {
    removeCurrentToast();
  }

  /* ---------------------------------------------------------------------- */
  /* Mobile navigation                                                      */
  /* ---------------------------------------------------------------------- */

  function initMobileNavigation() {
    const mobileMenuButton = document.getElementById('mobileMenuButton');
    const sidebar = document.getElementById('sidebarNav');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const navLinks = document.querySelectorAll('.sidebar .nav-link');

    if (!mobileMenuButton || !sidebar) {
      return;
    }

    function isMobileLayout() {
      return window.innerWidth <= 768;
    }

    // Keep the closed mobile drawer out of the keyboard tab order without
    // affecting the fixed sidebar on larger screens.
    function syncSidebarInertness() {
      sidebar.inert = isMobileLayout() &&
        !sidebar.classList.contains('is-open');
    }

    function openMenu() {
      sidebar.classList.add('is-open');
      if (sidebarOverlay) {
        sidebarOverlay.classList.add('is-visible');
      }
      mobileMenuButton.setAttribute('aria-expanded', 'true');
      mobileMenuButton.setAttribute('aria-label', 'Close navigation menu');
      // Prevent body scroll when menu is open
      document.body.style.overflow = 'hidden';
      syncSidebarInertness();
    }

    function closeMenu() {
      sidebar.classList.remove('is-open');
      if (sidebarOverlay) {
        sidebarOverlay.classList.remove('is-visible');
      }
      mobileMenuButton.setAttribute('aria-expanded', 'false');
      mobileMenuButton.setAttribute('aria-label', 'Open navigation menu');
      document.body.style.overflow = '';
      syncSidebarInertness();
    }

    // Toggle menu on button click
    mobileMenuButton.addEventListener('click', function () {
      const isExpanded = mobileMenuButton.getAttribute('aria-expanded') === 'true';
      if (isExpanded) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Close menu when overlay is clicked
    if (sidebarOverlay) {
      sidebarOverlay.addEventListener('click', closeMenu);
    }

    // Close menu when a navigation link is clicked
    navLinks.forEach(function (link) {
      link.addEventListener('click', function () {
        // Only close if on mobile (sidebar is in mobile mode)
        if (isMobileLayout()) {
          closeMenu();
        }
      });
    });

    // Close menu on Escape key
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        const isExpanded = mobileMenuButton.getAttribute('aria-expanded') === 'true';
        if (isExpanded) {
          closeMenu();
          mobileMenuButton.focus();
        }
      }
    });

    // Keep the drawer state correct when crossing the desktop breakpoint.
    window.addEventListener('resize', function () {
      if (!isMobileLayout()) {
        closeMenu();
      }
      syncSidebarInertness();
    });

    syncSidebarInertness();
  }

  /* ---------------------------------------------------------------------- */
  /* Boot                                                                   */
  /* ---------------------------------------------------------------------- */

  window.DaymarkUI = {
    notify: notify,
    clearToast: clearToast
  };

  function init() {
    ensureLiveRegion();
    initMobileNavigation();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
