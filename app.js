/**
 * Group Travel Matcher - Frontend Application Logic
 * Vanilla JavaScript (ES6+) with Fetch API
 */

const app = {
  state: {
    currentTraveller: null,
    allTravellers: [],
    interests: [],
    destinations: {},
    allGroups: [],
    currentView: 'seeker',
    userRole: 'seeker', // 'seeker' or 'creator'
    activeGroupId: 'G-01',
    activeGroupData: null,
    activeGroupHotels: [],
    votingTravellerId: null,
    searchResults: [],
    selectedSearchInterests: new Set(['TEMPLES', 'STREET_FOOD', 'ADVENTURE']),
    selectedSignupInterests: new Set(['TEMPLES', 'STREET_FOOD']),
    pollInterval: null,
    hasCelebratedConsensus: false
  },

  // ---------------------------------------------------------------------------
  // Application Lifecycle & Bootstrap
  // ---------------------------------------------------------------------------
  async init() {
    console.log('[APP] Initializing Group Travel Matcher...');
    this.setupDatePickers();

    try {
      const res = await fetch('/api/bootstrap');
      const data = await res.json();

      this.state.interests = data.interests || [];
      this.state.destinations = data.destinations || {};
      this.state.allTravellers = data.travellers || [];

      // Restore active persona from localStorage or default to T-001 (Sarah Thomas)
      const savedTid = localStorage.getItem('gm_active_traveller_id') || 'T-001';
      const user = this.state.allTravellers.find(t => t.traveller_id === savedTid) || this.state.allTravellers[0];
      this.setActiveTraveller(user);

      // Restore active role/flow from sessionStorage or localStorage
      const savedRole = sessionStorage.getItem('gm_active_role') || localStorage.getItem('gm_active_role');
      if (savedRole === 'seeker' || savedRole === 'creator') {
        this.state.userRole = savedRole;
      } else {
        this.state.userRole = (user && user.traveller_id === 'T-001') ? 'creator' : 'seeker';
      }
      this.updateNavForRole(this.state.userRole);

      // Render interest chips in search and signup forms
      this.renderInterestChips();
      this.populateFilterDropdowns();

      // Load all groups
      await this.fetchAllGroups();

      // Run default initial search (Priya's Scenario B) so matches are immediately visible
      await this.performSearch();

      // Load initial Common Group Page (G-01) in background
      await this.loadGroupData('G-01');

      // Check simulated system date state (Feature 4)
      try {
        const dateRes = await fetch('/api/system/date');
        const dateData = await dateRes.json();
        this.updateSimulatedDateUI(dateData.is_simulated, dateData.current_date);
      } catch (e) {}

      // Start light background poll for Common Group Page updates (3s)
      this.state.pollInterval = setInterval(() => {
        if (this.state.currentView === 'groupHub' && this.state.activeGroupId) {
          this.refreshGroupDataSilent();
        }
      }, 4000);

    } catch (err) {
      console.error('[APP] Initialization error:', err);
      this.showToast('Error connecting to backend server', 'error');
    }
  },

  setupDatePickers() {
    const ci = document.getElementById('searchCheckIn');
    const co = document.getElementById('searchCheckOut');
    if (ci && co) {
      const updateNights = () => {
        const d1 = new Date(ci.value);
        const d2 = new Date(co.value);
        if (d2 > d1) {
          const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
          const hint = document.getElementById('searchNightsHint');
          if (hint) hint.textContent = `${diffDays} night${diffDays > 1 ? 's' : ''}`;
        }
      };
      ci.addEventListener('change', updateNights);
      co.addEventListener('change', updateNights);
      updateNights();
    }
  },

  // ---------------------------------------------------------------------------
  // Persona & Identity Management (M1 & Testing Ease)
  // ---------------------------------------------------------------------------
  setActiveTraveller(user) {
    if (!user) return;
    this.state.currentTraveller = user;
    this.state.votingTravellerId = user.traveller_id;
    localStorage.setItem('gm_active_traveller_id', user.traveller_id);

    // Update Header Pill
    const avatarEl = document.getElementById('activeUserAvatar');
    const nameEl = document.getElementById('activeUserName');
    if (avatarEl) avatarEl.textContent = this.getInitials(user.name);
    if (nameEl) nameEl.textContent = user.name;

    // Update Creator Preview
    const cAvatar = document.getElementById('creatorPreviewAvatar');
    const cName = document.getElementById('creatorPreviewName');
    const cMeta = document.getElementById('creatorPreviewMeta');
    if (cAvatar) cAvatar.textContent = this.getInitials(user.name);
    if (cName) cName.textContent = user.name;
    if (cMeta) cMeta.textContent = `Gender: ${user.gender} · Preference: ${user.gender_preference} · Home: ${user.home_city || 'India'}`;

    // If on Common Page, refresh voting controls
    if (this.state.currentView === 'groupHub') {
      this.renderGroupMembersRoster();
      this.renderGroupHotels();
    }
  },

  switchPersona(travellerId) {
    const user = this.state.allTravellers.find(t => t.traveller_id === travellerId);
    if (user) {
      this.setActiveTraveller(user);
      this.closePersonaDropdown();

      // Automatically synchronize role based on persona:
      // Sarah (T-001) or group owners -> Creator Flow
      // Priya (T-002) and non-creators -> Seeker Flow
      const isOwner = travellerId === 'T-001' || this.state.allGroups.some(g => g.owner_id === travellerId);
      this.setRole(isOwner ? 'creator' : 'seeker');

      this.showToast(`Switched identity to ${user.name} (${this.state.userRole === 'creator' ? 'Creator' : 'Seeker'} Flow)`, 'success');
    }
  },

  // ---------------------------------------------------------------------------
  // Role & Flow Management (Conditional Nav Rendering)
  // ---------------------------------------------------------------------------
  setRole(role) {
    if (role !== 'seeker' && role !== 'creator') role = 'seeker';
    this.state.userRole = role;
    sessionStorage.setItem('gm_active_role', role);
    localStorage.setItem('gm_active_role', role);

    this.updateNavForRole(role);

    // If currently on a view that is not available in the new role, smoothly switch
    if (role === 'seeker' && this.state.currentView === 'creator') {
      this.showView('seeker');
    } else if (role === 'creator' && this.state.currentView === 'seeker') {
      this.showView('creator');
    }
  },

  toggleRole() {
    const nextRole = this.state.userRole === 'seeker' ? 'creator' : 'seeker';
    this.setRole(nextRole);
    this.showToast(`Active flow updated to ${nextRole === 'seeker' ? 'Seeker Flow (Find Groups)' : 'Creator Flow (Create Group)'}`, 'info');
  },

  updateNavForRole(role) {
    const seekerBtn = document.getElementById('navBtnSeeker');
    const creatorBtn = document.getElementById('navBtnCreator');
    const rolePill = document.getElementById('rolePillBadge');
    const roleBtnSeeker = document.getElementById('btnRoleSeeker');
    const roleBtnCreator = document.getElementById('btnRoleCreator');

    if (role === 'creator') {
      // Creator View: display "Create Group" link and completely hide "Find Groups" link
      if (seekerBtn) seekerBtn.style.display = 'none';
      if (creatorBtn) creatorBtn.style.display = 'inline-flex';
      if (rolePill) {
        rolePill.textContent = 'Creator Flow';
        rolePill.className = 'role-pill-badge creator';
      }
      if (roleBtnSeeker) roleBtnSeeker.classList.remove('active');
      if (roleBtnCreator) roleBtnCreator.classList.add('active');
    } else {
      // Seeker View: display "Find Groups" link and completely hide "Create Group" link
      if (seekerBtn) seekerBtn.style.display = 'inline-flex';
      if (creatorBtn) creatorBtn.style.display = 'none';
      if (rolePill) {
        rolePill.textContent = 'Seeker Flow';
        rolePill.className = 'role-pill-badge seeker';
      }
      if (roleBtnSeeker) roleBtnSeeker.classList.add('active');
      if (roleBtnCreator) roleBtnCreator.classList.remove('active');
    }

    // Common Links: ALWAYS visible
    const groupHubBtn = document.getElementById('navBtnGroupHub');
    const allGroupsBtn = document.getElementById('navBtnAllGroups');
    const travellersBtn = document.getElementById('navBtnTravellers');
    if (groupHubBtn) groupHubBtn.style.display = 'inline-flex';
    if (allGroupsBtn) allGroupsBtn.style.display = 'inline-flex';
    if (travellersBtn) travellersBtn.style.display = 'inline-flex';
  },

  togglePersonaDropdown() {
    const el = document.getElementById('personaDropdown');
    if (el) el.classList.toggle('open');
  },

  closePersonaDropdown() {
    const el = document.getElementById('personaDropdown');
    if (el) el.classList.remove('open');
  },

  // ---------------------------------------------------------------------------
  // Quick Scenario Buttons (Judges Live Demo)
  // ---------------------------------------------------------------------------
  quickScenarioA() {
    // Sarah (Creator of G-01)
    this.switchPersona('T-001');
    this.setRole('creator');
    this.showView('groupHub');
    this.loadGroupData('G-01');
    this.showToast('Acting as Sarah Thomas: Creator Flow active', 'success');
  },

  quickScenarioB() {
    // Priya (Seeker searching for Kyoto groups)
    this.switchPersona('T-002');
    this.setRole('seeker');
    this.resetSearchToScenarioB();
    this.showView('seeker');
    this.showToast('Acting as Priya Shah: Seeker Flow active', 'success');
  },

  quickOpenCommonPage(groupId) {
    this.loadGroupData(groupId || 'G-01');
    this.showView('groupHub');
  },

  resetSearchToScenarioB() {
    document.getElementById('searchCity').value = 'Kyoto';
    document.getElementById('searchCheckIn').value = '2027-04-09';
    document.getElementById('searchCheckOut').value = '2027-04-16';
    document.getElementById('searchBudget').value = '62000';
    document.getElementById('searchGenderPref').value = 'SAME_GENDER';

    this.state.selectedSearchInterests = new Set(['TEMPLES', 'STREET_FOOD', 'ADVENTURE']);
    this.renderInterestChips();
    this.performSearch();
  },

  // ---------------------------------------------------------------------------
  // Feature 4: Simulated Expiring Trip Date Toggle for Judges / Testing
  // ---------------------------------------------------------------------------
  async toggleSimulatedExpiringTrip() {
    try {
      const statusRes = await fetch('/api/system/date');
      const statusData = await statusRes.json();
      const isSim = statusData.is_simulated;

      // Toggle between 2027-04-06 (4 days before G-01 check_in 2027-04-10) and null (real date)
      const targetDate = isSim ? null : '2027-04-06';
      const postRes = await fetch('/api/system/date', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_date: targetDate })
      });
      const postData = await postRes.json();

      this.updateSimulatedDateUI(postData.is_simulated, postData.current_date);
      await this.performSearch();
      if (this.state.activeGroupId) {
        await this.loadGroupData(this.state.activeGroupId);
      }

      if (postData.is_simulated) {
        this.showToast(`Simulated Date: ${postData.current_date} (G-01 departs in 4 days! Pending requests auto-decline)`, 'error');
      } else {
        this.showToast(`Simulated Date Reset to Current Date (${postData.current_date})`, 'success');
      }
    } catch (err) {
      console.error('[SIMULATE DATE] Error:', err);
      this.showToast('Error toggling simulated system date', 'error');
    }
  },

  updateSimulatedDateUI(isSimulated, dateStr) {
    const btn = document.getElementById('demoBtnAutoDecline');
    if (btn) {
      if (isSimulated) {
        btn.classList.add('active');
        btn.style.background = '#fef2f2';
        btn.style.borderColor = '#ef4444';
        btn.style.color = '#b91c1c';
        btn.innerHTML = `<span>Feature 4:</span> ⚠️ Date: ${dateStr} (Reset)`;
      } else {
        btn.classList.remove('active');
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.innerHTML = `<span>Feature 4:</span> ⏳ Test Auto-Decline (Trip in ≤5d)`;
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Navigation & View Routing
  // ---------------------------------------------------------------------------
  showView(viewId) {
    // If navigating to a flow-specific view, keep role synchronized
    if (viewId === 'seeker' && this.state.userRole !== 'seeker') {
      this.setRole('seeker');
    } else if (viewId === 'creator' && this.state.userRole !== 'creator') {
      this.setRole('creator');
    }

    this.state.currentView = viewId;

    // Toggle nav active state
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewId);
    });

    // Toggle view visibility
    document.querySelectorAll('.content-view').forEach(view => {
      view.classList.toggle('active', view.id === `view-${viewId}`);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (viewId === 'allGroups') {
      this.renderAllGroupsGrid(this.state.allGroups);
    } else if (viewId === 'travellers') {
      this.renderTravellersGrid();
    } else if (viewId === 'groupHub' && this.state.activeGroupId) {
      this.loadGroupData(this.state.activeGroupId);
    }
  },

  // ---------------------------------------------------------------------------
  // Interest Chips Rendering
  // ---------------------------------------------------------------------------
  renderInterestChips() {
    const searchContainer = document.getElementById('searchInterestChips');
    const signupContainer = document.getElementById('signupInterestChips');

    if (searchContainer) {
      searchContainer.innerHTML = this.state.interests.map(i => {
        const isSelected = this.state.selectedSearchInterests.has(i.interest);
        return `
          <button type="button" 
                  class="interest-chip ${isSelected ? 'selected' : ''}" 
                  onclick="app.toggleSearchInterest('${i.interest}')">
            ${i.label}
          </button>
        `;
      }).join('');
      this.updateSelectedInterestsCount();
    }

    if (signupContainer) {
      signupContainer.innerHTML = this.state.interests.map(i => {
        const isSelected = this.state.selectedSignupInterests.has(i.interest);
        return `
          <button type="button" 
                  class="interest-chip ${isSelected ? 'selected' : ''}" 
                  onclick="app.toggleSignupInterest('${i.interest}')">
            ${i.label}
          </button>
        `;
      }).join('');
    }
  },

  toggleSearchInterest(tag) {
    if (this.state.selectedSearchInterests.has(tag)) {
      if (this.state.selectedSearchInterests.size > 1) {
        this.state.selectedSearchInterests.delete(tag);
      } else {
        this.showToast('Please keep at least 1 interest selected', 'error');
        return;
      }
    } else {
      this.state.selectedSearchInterests.add(tag);
    }
    this.renderInterestChips();
  },

  toggleSignupInterest(tag) {
    if (this.state.selectedSignupInterests.has(tag)) {
      this.state.selectedSignupInterests.delete(tag);
    } else {
      this.state.selectedSignupInterests.add(tag);
    }
    this.renderInterestChips();
  },

  updateSelectedInterestsCount() {
    const el = document.getElementById('selectedInterestsCount');
    if (el) {
      el.textContent = `${this.state.selectedSearchInterests.size} selected`;
    }
  },

  populateFilterDropdowns() {
    const select = document.getElementById('filterInterestSelect');
    if (select) {
      const opts = this.state.interests.map(i => `<option value="${i.interest}">${i.label}</option>`).join('');
      select.innerHTML = `<option value="ALL">All Interests</option>${opts}`;
    }
  },

  // ---------------------------------------------------------------------------
  // Seeker Search & The 6 Matching Rules (M3, M4, G1)
  // ---------------------------------------------------------------------------
  async handleSearchSubmit(e) {
    e.preventDefault();
    await this.performSearch();
  },

  async performSearch() {
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) searchBtn.disabled = true;

    const city = document.getElementById('searchCity').value;
    const checkIn = document.getElementById('searchCheckIn').value;
    const checkOut = document.getElementById('searchCheckOut').value;
    const budget = parseInt(document.getElementById('searchBudget').value, 10);
    const genderPref = document.getElementById('searchGenderPref').value;
    const interests = Array.from(this.state.selectedSearchInterests);
    const userGender = this.state.currentTraveller ? this.state.currentTraveller.gender : 'FEMALE';

    const payload = {
      city: city,
      check_in: checkIn,
      check_out: checkOut,
      budget_inr: budget,
      interests: interests,
      gender: userGender,
      gender_preference: genderPref,
      seeker_id: this.state.currentTraveller ? this.state.currentTraveller.traveller_id : null
    };

    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      this.state.searchResults = data.matches || [];
      this.applyClientFilters();

      const countBadge = document.getElementById('resultsCountBadge');
      if (countBadge) {
        countBadge.textContent = `${this.state.searchResults.length} verified match${this.state.searchResults.length === 1 ? '' : 'es'}`;
      }
    } catch (err) {
      console.error('[SEARCH] Error:', err);
      this.showToast('Search failed. Please verify dates and criteria.', 'error');
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  },

  applyClientFilters() {
    const interestFilter = document.getElementById('filterInterestSelect').value;
    const genderFilter = document.getElementById('filterGenderSelect').value;
    const sortBy = document.getElementById('sortBySelect').value;

    let filtered = [...this.state.searchResults];

    // G1: Filter by shared interest
    if (interestFilter !== 'ALL') {
      filtered = filtered.filter(g => {
        const shared = g.match_info?.rules_breakdown?.interests?.shared_items || [];
        return shared.includes(interestFilter);
      });
    }

    // G1: Filter by gender composition
    if (genderFilter === 'FEMALE_ONLY') {
      filtered = filtered.filter(g => g.owner?.gender === 'FEMALE' && g.owner?.gender_preference === 'SAME_GENDER');
    } else if (genderFilter === 'MALE_ONLY') {
      filtered = filtered.filter(g => g.owner?.gender === 'MALE' && g.owner?.gender_preference === 'SAME_GENDER');
    } else if (genderFilter === 'MIXED') {
      filtered = filtered.filter(g => g.owner?.gender_preference === 'ANY');
    }

    // Sort
    if (sortBy === 'SCORE') {
      filtered.sort((a, b) => (b.match_info?.compatibility_score || 0) - (a.match_info?.compatibility_score || 0));
    } else if (sortBy === 'NIGHTS') {
      filtered.sort((a, b) => (b.match_info?.rules_breakdown?.dates?.shared_nights || 0) - (a.match_info?.rules_breakdown?.dates?.shared_nights || 0));
    } else if (sortBy === 'BUDGET_LOW') {
      filtered.sort((a, b) => a.budget_inr - b.budget_inr);
    }

    this.renderSearchResults(filtered);
  },

  renderSearchResults(matches) {
    const grid = document.getElementById('matchResultsGrid');
    const emptyState = document.getElementById('emptyStateContainer');

    if (!matches || matches.length === 0) {
      grid.innerHTML = '';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = matches.map(group => {
      const info = group.match_info || {};
      const breakdown = info.rules_breakdown || {};
      const score = info.compatibility_score || 85;
      const owner = group.owner || {};
      const sharedInterests = breakdown.interests?.shared_items || [];
      const sharedNights = breakdown.dates?.shared_nights || 0;
      const overlapWindow = breakdown.dates?.overlap_window || '';
      const spotsLeft = group.max_size - (group.member_ids?.length || 1);

      return `
        <article class="match-card">
          <div class="card-top-bar">
            <span class="match-score-badge high">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${score}% Match
            </span>
            <span class="card-city-pill">${group.city}</span>
          </div>

          <div class="card-main-content">
            <h3 class="card-group-title">${group.name}</h3>
            <div class="card-dates-row">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
              <span>${group.check_in} to ${group.check_out}</span>
              <span class="shared-nights-tag">${sharedNights} shared nights</span>
            </div>

            <p class="card-itinerary-preview">${group.itinerary || 'No itinerary detailed yet.'}</p>

            <!-- Group Owner Card -->
            <div class="card-owner-section" onclick="app.showTravellerDetail('${owner.traveller_id}')" style="cursor:pointer;" title="Click to view owner profile">
              <div class="owner-avatar">${this.getInitials(owner.name || 'Owner')}</div>
              <div class="owner-info-text">
                <strong>${owner.name || 'Group Creator'}</strong>
                <span>Creator · ${owner.gender} · Pref: ${owner.gender_preference}</span>
              </div>
            </div>

            <!-- Shared Interests -->
            <div class="card-interests-row">
              <small style="font-size:0.75rem; color:var(--text-muted); width:100%;">Shared Interests with Owner (${sharedInterests.length}):</small>
              ${sharedInterests.map(si => `<span class="shared-int-chip">✓ ${this.getInterestLabel(si)}</span>`).join('')}
            </div>

            <!-- Stats Bar -->
            <div class="card-stats-row">
              <div class="stat-item">
                <span class="stat-label">Budget</span>
                <span class="stat-val">₹${group.budget_inr.toLocaleString('en-IN')}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Capacity</span>
                <span class="stat-val">${group.member_ids?.length || 1} / ${group.max_size} (${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left)</span>
              </div>
            </div>

            <!-- Expandable 6 Rules Verification Breakdown with Dynamic Color-Coding (Feature 3) -->
            ${(() => {
              const ruleValues = [
                breakdown.destination,
                breakdown.dates,
                breakdown.budget,
                breakdown.interests,
                breakdown.gender,
                breakdown.group_size
              ].filter(Boolean);
              const yellowCount = ruleValues.filter(r => r.color === 'yellow').length;
              const redCount = ruleValues.filter(r => r.color === 'red').length;
              const hasImpact = yellowCount > 0 || redCount > 0;

              const accordionHeaderNote = hasImpact
                ? `<span style="font-size:0.75rem; color:#b45309; font-weight:700;">⚠ ${yellowCount + redCount} criteria drag score down (${score}%)</span>`
                : `<span style="font-size:0.75rem; color:#15803d; font-weight:700;">✓ Optimal fit (${score}%)</span>`;

              const renderRuleItem = (ruleKey, title, defaultDetail) => {
                const r = breakdown[ruleKey] || {};
                const color = r.color || 'green';
                const marker = r.marker || '✓';
                const scorePct = r.score_pct;
                const detail = r.detail || defaultDetail;
                const badgeHtml = (scorePct !== undefined && scorePct !== null)
                  ? `<span class="rule-score-badge ${color}">${scorePct}%</span>`
                  : '';

                return `
                  <div class="rule-check-item ${color}">
                    <span class="rule-marker ${color}">${marker}</span>
                    <div class="rule-text ${color}">
                      <div class="rule-text-header">
                        <strong>${title}</strong>
                        ${badgeHtml}
                      </div>
                      <p>${detail}</p>
                    </div>
                  </div>
                `;
              };

              return `
                <div class="rules-accordion">
                  <button class="rules-accordion-toggle" onclick="app.toggleAccordion(this)">
                    <div style="display:flex; align-items:center; gap:0.6rem; flex-wrap:wrap;">
                      <span>Matching Rules Scorecard</span>
                      ${accordionHeaderNote}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <div class="rules-accordion-body">
                    ${renderRuleItem('destination', '1. Destination Match:', 'Exact city match')}
                    ${renderRuleItem('dates', '2. Date Overlap (≥ 2 nights):', '')}
                    ${renderRuleItem('budget', '3. Budget Compatibility (≤ 40% diff):', '')}
                    ${renderRuleItem('interests', '4. Shared Interests (≥ 2 with owner):', '')}
                    ${renderRuleItem('gender', '5. Mutual Gender Preference:', 'Mutual gender match')}
                    ${renderRuleItem('group_size', '6. Group Capacity:', '')}
                  </div>
                </div>
              `;
            })()}
          </div>

          <div class="card-actions-row">
            ${(() => {
              if (group.seeker_request) {
                const reqStatus = group.seeker_request.status;
                const reqMsg = group.seeker_request.message || '';
                if (reqStatus === 'REJECTED') {
                  return `
                    <div class="seeker-request-alert rejected">
                      <span style="font-size:1.2rem; line-height:1;">⚠️</span>
                      <div style="flex:1;">
                        <strong>${reqMsg || 'Request automatically declined'}</strong>
                        <div style="font-size:0.73rem; font-weight:normal; margin-top:2px;">Automated system check: Trip departure window is 5 days or less.</div>
                      </div>
                    </div>
                    <button class="btn-secondary" onclick="app.quickOpenCommonPage('${group.group_id}')">
                      View Page
                    </button>
                  `;
                } else if (reqStatus === 'PENDING') {
                  return `
                    <div class="seeker-request-alert pending">
                      <span style="font-size:1.2rem; line-height:1;">⏳</span>
                      <div style="flex:1;">
                        <strong>Request Pending Creator Review</strong>
                        <div style="font-size:0.73rem; font-weight:normal; margin-top:2px;">Notification sent to ${owner.name || 'group creator'}.</div>
                      </div>
                    </div>
                    <button class="btn-secondary" onclick="app.quickOpenCommonPage('${group.group_id}')">
                      View Page
                    </button>
                  `;
                } else if (reqStatus === 'APPROVED') {
                  return `
                    <div class="seeker-request-alert approved">
                      <span style="font-size:1.2rem; line-height:1;">✓</span>
                      <div style="flex:1;">
                        <strong>Approved Member · You're in!</strong>
                        <div style="font-size:0.73rem; font-weight:normal; margin-top:2px;">Vote on group hotel consensus now.</div>
                      </div>
                    </div>
                    <button class="btn-primary" onclick="app.quickOpenCommonPage('${group.group_id}')">
                      Open Hub
                    </button>
                  `;
                }
              }
              return `
                <button class="btn-primary" onclick="app.handleExpressInterest('${group.group_id}')">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
                  Express Interest
                </button>
                <button class="btn-secondary" onclick="app.quickOpenCommonPage('${group.group_id}')">
                  View Page
                </button>
              `;
            })()}
          </div>
        </article>
      `;
    }).join('');
  },

  toggleAccordion(btn) {
    const body = btn.nextElementSibling;
    if (body) {
      body.classList.toggle('open');
      const icon = btn.querySelector('svg');
      if (icon) {
        icon.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    }
  },

  // ---------------------------------------------------------------------------
  // Express Interest / Request to Join (M5 & Feature 4 Auto-Decline)
  // ---------------------------------------------------------------------------
  async handleExpressInterest(groupId) {
    if (!this.state.currentTraveller) {
      this.showToast('Please select or create an active profile first', 'error');
      return;
    }

    try {
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          seeker_id: this.state.currentTraveller.traveller_id,
          message: `Hi, I am ${this.state.currentTraveller.name}! My travel dates, budget, and interests closely match your post. I would love to join your trip!`
        })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.auto_declined || data.status === 'REJECTED') {
          this.showToast(data.message || 'Request automatically declined (trip departs in ≤ 5 days)', 'error');
        } else {
          this.showToast('Interest expressed! A notification was sent to the group creator.', 'success');
        }
        // Re-run search to immediately reflect request status banner on match card
        await this.performSearch();
        // Refresh Common Page if viewing this group
        if (this.state.activeGroupId === groupId) {
          this.loadGroupData(groupId);
        }
      } else {
        this.showToast(data.error || 'Failed to submit request', 'error');
      }
    } catch (err) {
      console.error('[JOIN] Error:', err);
      this.showToast('Could not submit request', 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // Creator Flow: Post a New Group (M2)
  // ---------------------------------------------------------------------------
  setItineraryPreset(type) {
    const itEl = document.getElementById('createGroupItinerary');
    if (!itEl) return;
    if (type === 'kyoto') {
      itEl.value = 'Sunrise meditation at Fushimi Inari, sampling street food skewers at Nishiki Market, bamboo grove photography in Arashiyama, and evening tea walk in Gion.';
    } else if (type === 'tokyo') {
      itEl.value = 'Asakusa Sensoji shrine at dawn, Shibuya crossing and retro game cafes in Akihabara, vintage shopping in Shimokitazawa, and ramen hopping at night.';
    } else if (type === 'dubai') {
      itEl.value = 'Sunset desert dune safari with campfire dinner, exploring Old Dubai spice and gold souks, boat ride on the Creek, and photography at Burj Khalifa.';
    }
  },

  async handleCreateGroupSubmit(e) {
    e.preventDefault();
    if (!this.state.currentTraveller) {
      this.showToast('Please select an active profile first', 'error');
      return;
    }

    const name = document.getElementById('createGroupName').value;
    const city = document.getElementById('createGroupCity').value;
    const checkIn = document.getElementById('createGroupCheckIn').value;
    const checkOut = document.getElementById('createGroupCheckOut').value;
    const maxSize = parseInt(document.getElementById('createGroupMaxSize').value, 10);
    const budget = parseInt(document.getElementById('createGroupBudget').value, 10);
    const itinerary = document.getElementById('createGroupItinerary').value;

    const payload = {
      name: name,
      owner_id: this.state.currentTraveller.traveller_id,
      city: city,
      check_in: checkIn,
      check_out: checkOut,
      max_size: maxSize,
      budget_inr: budget,
      itinerary: itinerary
    };

    const submitBtn = document.getElementById('publishGroupBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (res.ok) {
        this.showToast(`Group "${data.name}" created successfully!`, 'success');
        this.setRole('creator');
        await this.fetchAllGroups();
        this.quickOpenCommonPage(data.group_id);
      } else {
        this.showToast(data.error || 'Failed to create group post', 'error');
      }
    } catch (err) {
      console.error('[CREATE GROUP] Error:', err);
      this.showToast('Error creating group post', 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  // ---------------------------------------------------------------------------
  // Common Group Page (M6) & The "Wow Factor" Tinder-Style Voting Consensus Engine
  // ---------------------------------------------------------------------------
  async loadGroupData(groupId) {
    this.state.activeGroupId = groupId;
    try {
      const res = await fetch(`/api/groups/${groupId}`);
      if (!res.ok) throw new Error('Group not found');
      const group = await res.json();
      this.state.activeGroupData = group;

      // Update Group Banner
      document.getElementById('ghGroupName').textContent = group.name;
      document.getElementById('ghCityTag').textContent = `${group.city}, ${group.city === 'Dubai' || group.city === 'Abu Dhabi' ? 'UAE' : 'Japan'}`;
      document.getElementById('ghItinerary').textContent = group.itinerary || '';
      document.getElementById('ghDates').textContent = `${group.check_in} – ${group.check_out}`;
      document.getElementById('ghBudget').textContent = `₹${group.budget_inr.toLocaleString('en-IN')} / person`;
      document.getElementById('ghMembersCount').textContent = `${group.members?.length || 1} of ${group.max_size} Members`;
      document.getElementById('memberCountHeader').textContent = group.members?.length || 1;

      // Update nav active badge
      const hubBadge = document.getElementById('groupHubBadge');
      if (hubBadge) hubBadge.style.display = 'inline-block';

      // Check Booking Confirmed Status
      const banner = document.getElementById('bookingConfirmedBanner');
      if (group.booking) {
        banner.style.display = 'flex';
        document.getElementById('bookingConfirmedDetails').textContent = 
          `Reference #${group.booking.booking_id} · ${group.booking.hotel_name} (${group.booking.room_name}) · Total ₹${group.booking.total_cost.toLocaleString('en-IN')} · Split: ₹${group.booking.per_member_cost.toLocaleString('en-IN')} per member`;
      } else {
        banner.style.display = 'none';
      }

      // Check Creator Pending Requests (M5)
      await this.checkPendingRequests(groupId);

      // Render Members Roster & Voting Switcher
      this.renderGroupMembersRoster();

      // Fetch and Render Hotel Options
      await this.fetchGroupHotels(groupId);

      // Fetch Chat
      await this.fetchGroupChat(groupId);

    } catch (err) {
      console.error('[COMMON PAGE] Error:', err);
      this.showToast('Could not load group page', 'error');
    }
  },

  async refreshGroupDataSilent() {
    if (!this.state.activeGroupId) return;
    try {
      const res = await fetch(`/api/groups/${this.state.activeGroupId}`);
      if (!res.ok) return;
      this.state.activeGroupData = await res.json();
      await this.checkPendingRequests(this.state.activeGroupId);
      await this.fetchGroupHotels(this.state.activeGroupId, true);
      await this.fetchGroupChat(this.state.activeGroupId, true);
    } catch (e) {}
  },

  async checkPendingRequests(groupId) {
    const panel = document.getElementById('creatorRequestsPanel');
    const isOwner = this.state.currentTraveller && this.state.currentTraveller.traveller_id === this.state.activeGroupData?.owner_id;

    if (!isOwner) {
      panel.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/api/groups/${groupId}/requests`);
      const requests = await res.json();
      const pending = requests.filter(r => r.status === 'PENDING');

      if (pending.length > 0) {
        panel.style.display = 'block';
        document.getElementById('pendingRequestsCountBadge').textContent = `${pending.length} Pending`;
        document.getElementById('pendingRequestsList').innerHTML = pending.map(req => `
          <div class="request-item">
            <div class="request-user-info">
              <div class="owner-avatar">${this.getInitials(req.seeker_name)}</div>
              <div>
                <strong>${req.seeker_name} (${req.seeker_gender})</strong>
                <p style="font-size:0.75rem; color:var(--text-secondary);">${req.seeker_home_city ? 'From ' + req.seeker_home_city + ' · ' : ''}${req.message || ''}</p>
              </div>
            </div>
            <div class="request-actions">
              <button class="btn-approve" onclick="app.decideRequest('${groupId}', '${req.request_id}', 'APPROVE')">✓ Approve</button>
              <button class="btn-reject" onclick="app.decideRequest('${groupId}', '${req.request_id}', 'REJECT')">Decline</button>
            </div>
          </div>
        `).join('');
      } else {
        panel.style.display = 'none';
      }
    } catch (err) {
      console.error('[REQUESTS] Error:', err);
    }
  },

  async decideRequest(groupId, requestId, action) {
    try {
      const res = await fetch(`/api/groups/${groupId}/requests/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, action: action })
      });
      const data = await res.json();
      if (res.ok) {
        this.showToast(`Request ${action === 'APPROVE' ? 'Approved! Member joined the group' : 'Declined'}`, 'success');
        await this.loadGroupData(groupId);
      } else {
        this.showToast(data.error || 'Failed to update request', 'error');
      }
    } catch (err) {
      this.showToast('Error processing decision', 'error');
    }
  },

  renderGroupMembersRoster() {
    const list = document.getElementById('approvedMembersList');
    const switcher = document.getElementById('votingPersonaButtons');
    const group = this.state.activeGroupData;
    if (!group) return;

    const members = group.members || [];
    list.innerHTML = members.map(m => {
      const isOwner = m.traveller_id === group.owner_id;
      return `
        <div class="member-row-item">
          <div class="member-row-avatar">${this.getInitials(m.name)}</div>
          <div class="member-row-text">
            <strong>${m.name}</strong>
            <small>${m.gender} · ${m.home_city || 'India'}</small>
          </div>
          ${isOwner ? '<span class="creator-tag">Creator</span>' : ''}
        </div>
      `;
    }).join('');

    // Quick Voting Persona Switcher Buttons in sidebar
    switcher.innerHTML = members.map(m => {
      const isActive = this.state.votingTravellerId === m.traveller_id;
      return `
        <button class="switch-voter-btn ${isActive ? 'active' : ''}" 
                onclick="app.setVotingPersona('${m.traveller_id}')">
          ${m.name.split(' ')[0]} ${isActive ? '(Voting)' : ''}
        </button>
      `;
    }).join('');
  },

  setVotingPersona(travellerId) {
    this.state.votingTravellerId = travellerId;
    this.renderGroupMembersRoster();
    this.renderGroupHotels();
    const member = this.state.activeGroupData?.members?.find(m => m.traveller_id === travellerId);
    this.showToast(`Now voting as: ${member?.name || travellerId}`, 'success');
  },

  // ---------------------------------------------------------------------------
  // Hotel Availability, Pricing & Tinder Voting Engine (WOW FACTOR)
  // ---------------------------------------------------------------------------
  async fetchGroupHotels(groupId, silent = false) {
    try {
      const res = await fetch(`/api/groups/${groupId}/hotels`);
      const hotels = await res.json();
      this.state.activeGroupHotels = hotels || [];
      this.renderGroupHotels();

      if (!silent) {
        document.getElementById('hotelsCountText').textContent = 
          `Found ${hotels.length} verified hotel option${hotels.length === 1 ? '' : 's'} in ${this.state.activeGroupData.city}`;
      }
    } catch (err) {
      console.error('[HOTELS] Error:', err);
    }
  },

  renderGroupHotels() {
    const container = document.getElementById('groupHotelsList');
    const sortVal = document.getElementById('hotelSortSelect')?.value || 'RECOMMENDED';
    const group = this.state.activeGroupData;
    if (!group) return;

    let hotels = [...this.state.activeGroupHotels];

    // Sorting
    if (sortVal === 'RATING_DESC') {
      hotels.sort((a, b) => b.rating - a.rating);
    } else if (sortVal === 'PRICE_ASC') {
      hotels.sort((a, b) => a.per_member_cost - b.per_member_cost);
    } else if (sortVal === 'TOTAL_ASC') {
      hotels.sort((a, b) => a.total_cost - b.total_cost);
    } else {
      // Consensus first, then rating
      hotels.sort((a, b) => (b.votes.has_consensus ? 1 : 0) - (a.votes.has_consensus ? 1 : 0) || b.rating - a.rating);
    }

    // Check overall consensus status for meter
    const bestConsensus = hotels.find(h => h.votes.has_consensus);
    const maxVotesPct = Math.max(0, ...hotels.map(h => h.votes.consensus_pct || 0));

    const statusText = document.getElementById('consensusStatusText');
    const statusPct = document.getElementById('consensusStatusPct');
    const meterFill = document.getElementById('consensusMeterFill');

    if (bestConsensus) {
      statusText.innerHTML = `🎉 <strong>100% Unanimous Consensus!</strong> Group agreed on ${bestConsensus.hotel_name}`;
      statusPct.textContent = '100% agreed';
      meterFill.style.width = '100%';
      meterFill.classList.add('consensus-complete');

      if (!this.state.hasCelebratedConsensus) {
        this.triggerConfetti();
        this.state.hasCelebratedConsensus = true;
      }
    } else {
      this.state.hasCelebratedConsensus = false;
      statusText.textContent = `🔒 Consensus: All ${group.members?.length || 1} members must upvote the same option to unlock booking`;
      statusPct.textContent = `${maxVotesPct}% top vote`;
      meterFill.style.width = `${maxVotesPct}%`;
      meterFill.classList.remove('consensus-complete');
    }

    const members = group.members || [];
    const activeVoterId = this.state.votingTravellerId;
    const isBooked = !!group.booking;

    container.innerHTML = hotels.map(opt => {
      const v = opt.votes;
      const isConsensus = v.has_consensus;
      const upvoters = v.upvoter_ids || [];
      const downvoters = v.downvoter_ids || [];

      const activeMemberUpvoted = upvoters.includes(activeVoterId);
      const activeMemberDownvoted = downvoters.includes(activeVoterId);

      // Star display
      const starsArr = '★'.repeat(opt.stars) + '☆'.repeat(5 - opt.stars);

      return `
        <article class="hotel-consensus-card ${isConsensus ? 'consensus-unlocked' : ''}">
          ${isConsensus ? `
            <div class="consensus-unlocked-ribbon">
              <span>★</span> 100% Consensus Reached!
            </div>
          ` : ''}

          <!-- Hotel Image with Attribution Link -->
          <div class="hotel-card-media">
            <img src="${opt.image}" alt="${opt.hotel_name}" onerror="this.src='images/hotels/HOTEL-BUSINESS-1.jpg'">
            <div class="hotel-stars-badge">${starsArr}</div>
          </div>

          <!-- Hotel & Room Details -->
          <div class="hotel-card-details">
            <div class="hotel-details-header">
              <div class="hotel-title-area">
                <h3>${opt.hotel_name}</h3>
                <span class="hotel-area-text">${opt.area}, ${group.city}</span>
              </div>
              <div class="hotel-score-box">
                ${opt.rating.toFixed(1)}
              </div>
            </div>

            <div class="room-type-tag">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>
              ${opt.room_name} (${opt.room_type}) · Max ${opt.max_adults} Adults
            </div>

            <!-- Capacity Formula Box -->
            <div class="capacity-formula-box">
              <span>Rooms Needed: <strong>${opt.rooms_needed} room${opt.rooms_needed > 1 ? 's' : ''}</strong> (${members.length} member${members.length > 1 ? 's' : ''} ÷ ${opt.max_adults} adults/room, rounded up)</span>
            </div>

            <!-- Availability status across all nights -->
            <div class="availability-status-row">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Verified Availability: At least ${opt.min_free_rooms} free rooms on all ${opt.nights_count} nights</span>
            </div>

            <!-- Member Voting Deck -->
            <div class="voting-deck-section">
              <div class="voting-deck-header">
                <span>Member Consensus Alignment (${v.up_count}/${members.length} agreed):</span>
                <span>${v.consensus_pct}%</span>
              </div>

              <!-- Matrix of Who Voted What -->
              <div class="member-votes-matrix">
                ${members.map(m => {
                  const hasUp = upvoters.includes(m.traveller_id);
                  const hasDown = downvoters.includes(m.traveller_id);
                  let statusClass = 'vote-pending';
                  let icon = '⏳';
                  if (hasUp) { statusClass = 'voted-up'; icon = '👍'; }
                  else if (hasDown) { statusClass = 'voted-down'; icon = '👎'; }

                  return `
                    <div class="member-vote-pill ${statusClass}" title="${m.name}: ${hasUp ? 'Upvoted' : hasDown ? 'Downvoted' : 'Pending Vote'}">
                      <span>${m.name.split(' ')[0]}</span>
                      <strong>${icon}</strong>
                    </div>
                  `;
                }).join('')}
              </div>

              <!-- Tinder Style Vote Controls for Active Persona -->
              <div class="tinder-voting-controls">
                <button class="btn-tinder-vote downvote ${activeMemberDownvoted ? 'active-vote' : ''}" 
                        onclick="app.castVote('${group.group_id}', '${opt.room_id}', -1)">
                  <span>👎</span> Pass
                </button>
                <button class="btn-tinder-vote upvote ${activeMemberUpvoted ? 'active-vote' : ''}" 
                        onclick="app.castVote('${group.group_id}', '${opt.room_id}', 1)">
                  <span>👍</span> Love it!
                </button>
                <small style="margin-left:auto; font-size:0.75rem; color:var(--text-muted);">
                  Voting as <strong>${members.find(m => m.traveller_id === activeVoterId)?.name?.split(' ')[0] || 'You'}</strong>
                </small>
              </div>
            </div>

            <!-- Bottom Pricing & Final Booking CTA -->
            <div class="hotel-card-bottom-row">
              <div class="hotel-pricing-box">
                <span class="price-total-text">Total for ${opt.nights_count} nights: ₹${opt.total_cost.toLocaleString('en-IN')}</span>
                <span class="price-per-person-text">₹${opt.per_member_cost.toLocaleString('en-IN')} <span>/ person</span></span>
              </div>

              <!-- THE MAGIC BOOK CTA -->
              ${isBooked ? `
                <button class="btn-book-consensus" disabled style="background:#059669; color:white;">
                  ✓ Trip Booked
                </button>
              ` : `
                <button class="btn-book-consensus ${isConsensus ? 'unlocked' : 'locked'}"
                        ${!isConsensus ? 'disabled' : ''}
                        onclick="app.finalizeBooking('${group.group_id}', '${opt.room_id}')">
                  ${isConsensus ? `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    Finalize Group Booking!
                  ` : `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    Locked (${v.up_count}/${members.length} Votes)
                  `}
                </button>
              `}
            </div>
          </div>
        </article>
      `;
    }).join('');
  },

  async castVote(groupId, roomId, voteValue) {
    if (!this.state.votingTravellerId) {
      this.showToast('Please select a voting member in the sidebar first', 'error');
      return;
    }

    try {
      const res = await fetch(`/api/groups/${groupId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          group_id: groupId,
          room_id: roomId,
          traveller_id: this.state.votingTravellerId,
          vote: voteValue
        })
      });

      const data = await res.json();
      if (res.ok) {
        if (data.unanimous_consensus) {
          this.showToast('🎉 Unanimous agreement reached! The Finalize Booking button is now UNLOCKED!', 'success');
          this.triggerConfetti();
        } else {
          this.showToast(voteValue === 1 ? '👍 Upvoted hotel option!' : '👎 Downvoted hotel option', 'success');
        }
        await this.fetchGroupHotels(groupId);
      } else {
        this.showToast(data.error || 'Failed to record vote', 'error');
      }
    } catch (err) {
      console.error('[VOTE] Error:', err);
      this.showToast('Error recording vote', 'error');
    }
  },

  async finalizeBooking(groupId, roomId) {
    const group = this.state.activeGroupData;
    const hotelOpt = this.state.activeGroupHotels.find(h => h.room_id === roomId);
    if (!hotelOpt) return;

    try {
      const res = await fetch(`/api/groups/${groupId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: roomId,
          booked_by: this.state.currentTraveller ? this.state.currentTraveller.name : 'Group Consensus'
        })
      });

      const data = await res.json();
      if (res.ok) {
        this.triggerConfetti();
        this.showToast('🎉 Booking Confirmed! Official digital voucher generated.', 'success');
        await this.loadGroupData(groupId);
        this.showBookingVoucherModal(data.booking, hotelOpt, group);
      } else {
        this.showToast(data.error || 'Failed to confirm booking', 'error');
      }
    } catch (err) {
      console.error('[BOOKING] Error:', err);
      this.showToast('Error finalizing booking', 'error');
    }
  },

  showBookingVoucherModal(booking, hotelOpt, group) {
    const modal = document.getElementById('bookingVoucherModal');
    const body = document.getElementById('bookingVoucherBody');
    if (!modal || !body) return;

    body.innerHTML = `
      <div style="background:#ecfdf5; border:2px solid #10b981; border-radius:12px; padding:1.5rem; margin-bottom:1.5rem; text-align:center;">
        <span style="font-size:2.5rem;">✈️ 🏨</span>
        <h3 style="color:#065f46; font-size:1.4rem; margin-top:0.4rem;">Group Reservation Confirmed</h3>
        <p style="color:#047857; font-weight:700;">Booking Reference: #${booking.booking_id}</p>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; font-size:0.9rem; margin-bottom:1.5rem;">
        <div>
          <strong style="color:var(--text-muted); display:block; font-size:0.75rem;">HOTEL & ROOM</strong>
          <span style="font-size:1.1rem; font-weight:800; color:var(--navy-dark);">${booking.hotel_name}</span>
          <p>${booking.room_name} (${booking.rooms_count} Room${booking.rooms_count > 1 ? 's' : ''})</p>
        </div>
        <div>
          <strong style="color:var(--text-muted); display:block; font-size:0.75rem;">STAY DATES & DESTINATION</strong>
          <span style="font-size:1.1rem; font-weight:800; color:var(--navy-dark);">${group.city}</span>
          <p>${group.check_in} to ${group.check_out} (${booking.nights_count} nights)</p>
        </div>
      </div>

      <div style="background:#f8fafc; border-radius:10px; padding:1.2rem; margin-bottom:1.5rem;">
        <h4 style="margin-bottom:0.75rem; color:var(--navy-dark);">Cost Split Breakdown</h4>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
          <span>Total Hotel Cost (${booking.rooms_count} room × ${booking.nights_count} nights):</span>
          <strong>₹${booking.total_cost.toLocaleString('en-IN')}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:0.4rem;">
          <span>Number of Group Members:</span>
          <strong>${group.members?.length || 1} people</strong>
        </div>
        <div style="display:flex; justify-content:space-between; border-top:1px solid #cbd5e1; padding-top:0.6rem; font-size:1.15rem; color:#065f46;">
          <strong>Per-Person Share:</strong>
          <strong>₹${booking.per_member_cost.toLocaleString('en-IN')}</strong>
        </div>
      </div>

      <div style="font-size:0.8rem; color:var(--text-muted); text-align:center;">
        Unanimously agreed by all approved members: ${(group.members || []).map(m => m.name).join(', ')}.
      </div>
    `;

    modal.style.display = 'flex';
  },

  viewBookingReceipt() {
    const group = this.state.activeGroupData;
    if (group && group.booking) {
      this.showBookingVoucherModal(group.booking, {}, group);
    }
  },

  // ---------------------------------------------------------------------------
  // Group Coordination Chat (Stretch S1)
  // ---------------------------------------------------------------------------
  async fetchGroupChat(groupId, silent = false) {
    try {
      const res = await fetch(`/api/groups/${groupId}/chat`);
      const messages = await res.json();
      const container = document.getElementById('chatMessagesContainer');
      if (!container) return;

      const currentTravellerId = this.state.votingTravellerId;

      container.innerHTML = messages.length === 0 ? `
        <div style="text-align:center; padding:2rem 1rem; color:var(--text-muted); font-size:0.82rem;">
          No messages yet. Say hello to your group members!
        </div>
      ` : messages.map(m => {
        const isMine = m.sender_id === currentTravellerId;
        return `
          <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
            <span class="chat-sender-name">${m.sender_name}</span>
            <span>${m.message}</span>
            <span class="chat-time">${m.created_at}</span>
          </div>
        `;
      }).join('');

      if (!silent) {
        container.scrollTop = container.scrollHeight;
      }
    } catch (e) {}
  },

  async handleSendChatMessage(e) {
    e.preventDefault();
    const input = document.getElementById('chatInputMessage');
    const msg = input.value.trim();
    if (!msg || !this.state.activeGroupId) return;

    try {
      const res = await fetch(`/api/groups/${this.state.activeGroupId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_id: this.state.votingTravellerId,
          message: msg
        })
      });

      if (res.ok) {
        input.value = '';
        await this.fetchGroupChat(this.state.activeGroupId);
      }
    } catch (err) {
      this.showToast('Could not send message', 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // All Open Groups Directory View
  // ---------------------------------------------------------------------------
  async fetchAllGroups() {
    try {
      const res = await fetch('/api/groups');
      const groups = await res.json();
      this.state.allGroups = groups || [];
      const countEl = document.getElementById('allGroupsCount');
      if (countEl) countEl.textContent = groups.length;
    } catch (e) {}
  },

  filterAllGroupsByCity(city) {
    document.querySelectorAll('.city-tab').forEach(t => {
      t.classList.toggle('active', t.textContent.includes(city) || (city === 'ALL' && t.textContent.includes('All')));
    });

    const filtered = city === 'ALL' ? this.state.allGroups : this.state.allGroups.filter(g => g.city.toLowerCase() === city.toLowerCase());
    this.renderAllGroupsGrid(filtered);
  },

  renderAllGroupsGrid(groups) {
    const grid = document.getElementById('allGroupsGrid');
    if (!grid) return;

    grid.innerHTML = groups.map(g => {
      const owner = g.owner || {};
      const spotsLeft = g.max_size - (g.member_ids?.length || 1);
      return `
        <article class="match-card">
          <div class="card-top-bar">
            <span class="card-city-pill">${g.city}</span>
            <span style="font-size:0.75rem; color:var(--text-muted);">${g.check_in} to ${g.check_out}</span>
          </div>
          <div class="card-main-content">
            <h3 class="card-group-title">${g.name}</h3>
            <p class="card-itinerary-preview">${g.itinerary}</p>

            <div class="card-owner-section" onclick="app.showTravellerDetail('${owner.traveller_id}')" style="cursor:pointer;">
              <div class="owner-avatar">${this.getInitials(owner.name || 'Owner')}</div>
              <div class="owner-info-text">
                <strong>${owner.name || 'Creator'}</strong>
                <span>Creator · ${owner.gender} · Pref: ${owner.gender_preference}</span>
              </div>
            </div>

            <div class="card-stats-row">
              <div class="stat-item">
                <span class="stat-label">Budget</span>
                <span class="stat-val">₹${g.budget_inr.toLocaleString('en-IN')}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Spots Left</span>
                <span class="stat-val">${spotsLeft} of ${g.max_size}</span>
              </div>
            </div>
          </div>
          <div class="card-actions-row">
            <button class="btn-primary full-width" onclick="app.quickOpenCommonPage('${g.group_id}')">
              Open Group Page
            </button>
          </div>
        </article>
      `;
    }).join('');
  },

  // ---------------------------------------------------------------------------
  // Travellers Directory & Profile Modals (G2)
  // ---------------------------------------------------------------------------
  renderTravellersGrid() {
    const grid = document.getElementById('travellersGrid');
    if (!grid) return;

    grid.innerHTML = this.state.allTravellers.map(t => {
      const isCurrent = this.state.currentTraveller?.traveller_id === t.traveller_id;
      return `
        <article class="traveller-card">
          <div class="traveller-header-row">
            <div class="traveller-avatar-large">${this.getInitials(t.name)}</div>
            <div class="traveller-title-meta">
              <strong>${t.name}</strong>
              <span>${t.gender} · Age ${t.age}</span>
            </div>
          </div>

          <div class="traveller-body">
            <div class="meta-pill-row">
              <span class="meta-sub-pill">📍 ${t.home_city || 'India'} (${t.home_airport || 'BLR'})</span>
              <span class="meta-sub-pill">Preference: ${t.gender_preference}</span>
            </div>

            <div>
              <small style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:0.35rem;">Interests:</small>
              <div style="display:flex; flex-wrap:wrap; gap:0.3rem;">
                ${(t.interests || []).map(i => `<span class="meta-sub-pill">${this.getInterestLabel(i)}</span>`).join('')}
              </div>
            </div>
          </div>

          <div style="display:flex; gap:0.5rem; margin-top:auto;">
            <button class="btn-outline full-width" onclick="app.showTravellerDetail('${t.traveller_id}')">
              View Profile
            </button>
            <button class="btn-primary full-width" onclick="app.switchPersona('${t.traveller_id}')">
              ${isCurrent ? 'Active Persona' : 'Act as User'}
            </button>
          </div>
        </article>
      `;
    }).join('');
  },

  showTravellerDetail(travellerId) {
    const t = this.state.allTravellers.find(x => x.traveller_id === travellerId);
    if (!t) return;

    const modal = document.getElementById('profileDetailModal');
    const body = document.getElementById('profileDetailBody');
    if (!modal || !body) return;

    // Check which groups this traveller belongs to
    const userGroups = this.state.allGroups.filter(g => (g.member_ids || []).includes(t.traveller_id));

    body.innerHTML = `
      <div style="display:flex; align-items:center; gap:1.25rem; margin-bottom:1.5rem;">
        <div class="traveller-avatar-large" style="width:64px; height:64px; font-size:1.35rem;">
          ${this.getInitials(t.name)}
        </div>
        <div>
          <h3 style="font-size:1.4rem; color:var(--navy-dark);">${t.name}</h3>
          <p style="color:var(--text-secondary);">${t.gender} · Age ${t.age} · Origin: ${t.home_city || 'India'} (${t.home_airport || 'Airport'})</p>
          <span class="group-city-tag" style="background:#e0f2fe; color:#0369a1; margin-top:0.35rem; display:inline-block;">Gender Preference: ${t.gender_preference}</span>
        </div>
      </div>

      <div style="margin-bottom:1.5rem;">
        <h4 style="margin-bottom:0.5rem; color:var(--navy-dark);">Personal Interests</h4>
        <div style="display:flex; flex-wrap:wrap; gap:0.4rem;">
          ${(t.interests || []).map(i => `<span class="interest-chip selected" style="cursor:default;">${this.getInterestLabel(i)}</span>`).join('')}
        </div>
      </div>

      <div style="margin-bottom:1.5rem;">
        <h4 style="margin-bottom:0.5rem; color:var(--navy-dark);">Current Trips & Groups (${userGroups.length})</h4>
        ${userGroups.length === 0 ? '<p style="color:var(--text-muted); font-size:0.85rem;">Not currently part of any published groups.</p>' : userGroups.map(ug => `
          <div style="padding:0.75rem; background:var(--bg-page); border-radius:8px; margin-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>${ug.name}</strong>
              <div style="font-size:0.75rem; color:var(--text-muted);">${ug.city} · ${ug.check_in} to ${ug.check_out}</div>
            </div>
            <button class="btn-secondary" style="padding:0.35rem 0.75rem; font-size:0.75rem;" onclick="app.closeModal('profileDetailModal'); app.quickOpenCommonPage('${ug.group_id}')">Open</button>
          </div>
        `).join('')}
      </div>

      <button class="btn-primary full-width" onclick="app.switchPersona('${t.traveller_id}'); app.closeModal('profileDetailModal');">
        Act as ${t.name}
      </button>
    `;

    modal.style.display = 'flex';
  },

  showGroupMembersModal() {
    const group = this.state.activeGroupData;
    if (!group) return;

    const modal = document.getElementById('profileDetailModal');
    const body = document.getElementById('profileDetailBody');
    if (!modal || !body) return;

    body.innerHTML = `
      <h3 style="margin-bottom:1.25rem; color:var(--navy-dark);">Group Members (${group.members?.length || 1})</h3>
      <div style="display:flex; flex-direction:column; gap:1rem;">
        ${(group.members || []).map(m => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:0.85rem; border:1px solid var(--border-color); border-radius:10px;">
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <div class="owner-avatar">${this.getInitials(m.name)}</div>
              <div>
                <strong>${m.name} ${m.traveller_id === group.owner_id ? '(Creator)' : ''}</strong>
                <p style="font-size:0.78rem; color:var(--text-secondary);">${m.gender} · ${m.home_city || 'India'} · Pref: ${m.gender_preference}</p>
                <div style="display:flex; flex-wrap:wrap; gap:0.25rem; margin-top:0.3rem;">
                  ${(m.interests || []).map(i => `<span class="meta-sub-pill">${this.getInterestLabel(i)}</span>`).join('')}
                </div>
              </div>
            </div>
            <button class="btn-secondary" style="font-size:0.78rem; padding:0.35rem 0.65rem;" onclick="app.setVotingPersona('${m.traveller_id}'); app.closeModal('profileDetailModal');">
              Vote as this member
            </button>
          </div>
        `).join('')}
      </div>
    `;

    modal.style.display = 'flex';
  },

  // ---------------------------------------------------------------------------
  // Sign Up / New Traveller Profile Modal (M1)
  // ---------------------------------------------------------------------------
  openSignupModal() {
    this.closePersonaDropdown();
    const modal = document.getElementById('signupModal');
    if (modal) modal.style.display = 'flex';
  },

  async handleSignupSubmit(e) {
    e.preventDefault();
    const name = document.getElementById('newTravellerName').value.trim();
    const gender = document.getElementById('newTravellerGender').value;
    const age = parseInt(document.getElementById('newTravellerAge').value, 10);
    const city = document.getElementById('newTravellerCity').value.trim();
    const pref = document.getElementById('newTravellerPref').value;
    const interests = Array.from(this.state.selectedSignupInterests);

    if (interests.length < 2) {
      this.showToast('Please select at least 2 interests', 'error');
      return;
    }

    try {
      const res = await fetch('/api/travellers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          gender: gender,
          age: age,
          home_city: city,
          home_airport: city.slice(0, 3).toUpperCase(),
          interests: interests,
          gender_preference: pref
        })
      });

      const newTraveller = await res.json();
      if (res.ok) {
        this.state.allTravellers.push(newTraveller);
        this.setActiveTraveller(newTraveller);
        this.closeModal('signupModal');
        this.showToast(`Welcome ${newTraveller.name}! Profile created and saved.`, 'success');
      } else {
        this.showToast(newTraveller.error || 'Failed to create profile', 'error');
      }
    } catch (err) {
      console.error('[SIGNUP] Error:', err);
      this.showToast('Error registering profile', 'error');
    }
  },

  // ---------------------------------------------------------------------------
  // Rules Modal
  // ---------------------------------------------------------------------------
  openRulesModal() {
    const modal = document.getElementById('rulesModal');
    if (modal) modal.style.display = 'flex';
  },

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  },

  // ---------------------------------------------------------------------------
  // Confetti Particle System
  // ---------------------------------------------------------------------------
  triggerConfetti() {
    const canvas = document.getElementById('confettiCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = [];
    const colors = ['#00a651', '#006ce4', '#f59e0b', '#ec4899', '#38bdf8', '#a855f7'];

    for (let i = 0; i < 120; i++) {
      pieces.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        r: Math.random() * 6 + 4,
        d: Math.random() * 120 + 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleInc: (Math.random() * 0.07) + 0.05,
        tiltAngle: 0
      });
    }

    let animationFrame;
    let duration = 0;

    function render() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      duration++;
      pieces.forEach(p => {
        p.tiltAngle += p.tiltAngleInc;
        p.y += (Math.cos(p.d) + 3 + p.r / 2) / 1.5;
        p.tilt = Math.sin(p.tiltAngle) * 15;

        ctx.beginPath();
        ctx.lineWidth = p.r;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
        ctx.stroke();
      });

      if (duration < 180) {
        animationFrame = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        cancelAnimationFrame(animationFrame);
      }
    }
    render();
  },

  // ---------------------------------------------------------------------------
  // Toast Notifications
  // ---------------------------------------------------------------------------
  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  },

  // ---------------------------------------------------------------------------
  // Utility Helpers
  // ---------------------------------------------------------------------------
  getInitials(name) {
    if (!name) return 'GM';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  },

  getInterestLabel(interestId) {
    const found = this.state.interests.find(i => i.interest === interestId);
    return found ? found.label : interestId;
  }
};

// Initialize Application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
