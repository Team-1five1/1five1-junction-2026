/**
 * Verius Badge Renderer
 * Translates compact SemEval Question IDs (Q1-Q44) into clean UI badges on the frontend.
 * Renders expandable Deep Research Explanation card and Review Bombing Notice banners.
 */
(function() {
  'use strict';

  const SEMEVAL_LABELS = {
    Q1: "Loaded Words",
    Q2: "Exaggeration",
    Q3: "Minimization",
    Q4: "Alarmist Formatting",
    Q5: "Intentional Vagueness",
    Q6: "Bait-and-Switch",
    Q7: "Unbacked Absolutes",
    Q8: "Dehumanizing Metaphor",
    Q9: "Name-Calling",
    Q10: "Sweeping Stereotype",
    Q11: "Guilt by Association",
    Q12: "Extreme Historical Analogy",
    Q13: "Assumed Malice",
    Q14: "Manufactured Doubt",
    Q15: "Hypocrisy Deflection",
    Q16: "Out-Group Villainization",
    Q17: "Shadowy Cabal Framing",
    Q18: "Existential Fear",
    Q19: "Prejudice Activation",
    Q20: "Loyalty / Flag-Waving",
    Q21: "In-Group Flattery",
    Q22: "Bandwagon Pressure",
    Q23: "False Authority",
    Q24: "Weaponized Values",
    Q25: "Grievance Amplification",
    Q26: "Black-and-White Fallacy",
    Q27: "Single-Cause Scapegoating",
    Q28: "Magic-Bullet / Total-Ruin",
    Q29: "Slippery Slope",
    Q30: "Cherry-Picked Anecdote",
    Q31: "Coincidence as Conspiracy",
    Q32: "No-Choice Framing",
    Q33: "Whataboutism",
    Q34: "Strawman Distortion",
    Q35: "Red Herring",
    Q36: "Unverifiable Sourcing",
    Q37: "Disguised Partisanship",
    Q38: "Contradictory Flooding",
    Q39: "Thought-Killer Cliché",
    Q40: "Slogan Repetition",
    Q41: "Artificial Urgency",
    Q42: "Engagement Bait",
    Q43: "Keyword Stuffing",
    Q44: "Template Phrasing"
  };

  function toggleExplanationCard(btn) {
    const wrapper = btn.closest('.shield-explanation-wrapper') || btn.parentElement;
    if (!wrapper) return;
    const card = wrapper.querySelector('.shield-explanation-card');
    if (!card) return;

    const isVisible = card.classList.contains('visible') || card.style.display === 'block';
    if (isVisible) {
      card.classList.remove('visible');
      card.style.display = 'none';
      btn.textContent = '🛡️ View Fact Check and Context';
      btn.setAttribute('aria-expanded', 'false');
    } else {
      card.classList.add('visible');
      card.style.display = 'block';
      btn.textContent = '▲ Hide Fact Check and Context';
      btn.setAttribute('aria-expanded', 'true');
    }
  }

  function renderBadges() {
    const containers = document.querySelectorAll('.shield-badge-container:not(.rendered)');
    containers.forEach(function(container) {
      container.classList.add('rendered');
      const rawIds = container.dataset.failedIds;
      if (!rawIds) return;

      let ids = [];
      try {
        ids = JSON.parse(rawIds);
      } catch(e) {
        return;
      }

      if (!Array.isArray(ids) || ids.length === 0) return;

      const badgeList = document.createElement('div');
      badgeList.className = 'shield-badge-list';

      ids.forEach(function(id) {
        const label = SEMEVAL_LABELS[id] || id;
        const badge = document.createElement('span');
        badge.className = 'shield-badge';
        badge.textContent = `⚠️ ${label}`;
        badge.title = `SemEval Criteria ${id}: ${label}`;
        badgeList.appendChild(badge);
      });

      container.appendChild(badgeList);
    });

    // Expandable explanation toggle binding
    const toggleButtons = document.querySelectorAll('.shield-explanation-toggle:not(.bound)');
    toggleButtons.forEach(function(btn) {
      btn.classList.add('bound');
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        toggleExplanationCard(btn);
      });
    });
  }

  // Document-level event delegation ensures clicks always trigger even with dynamic comments or wpautop
  document.addEventListener('click', function(e) {
    const btn = e.target.closest('.shield-explanation-toggle');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      toggleExplanationCard(btn);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', renderBadges);
  } else {
    renderBadges();
  }
})();
