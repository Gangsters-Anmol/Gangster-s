/**
 * script.js — Class Memories Website
 * Original engine (fog, family, overlays) + theme toggle + updated member data
 * Converted to ES Module for Firebase compatibility
 */

import { db }           from "./firebase-config.js";
import { onAuthChange, currentUser, currentProfile } from "./auth.js";
import { doc, updateDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js";

/* ============================================================
   1. DATA — Edit names here to update the site
   ============================================================ */
const FAMILY_DATA = {
  boys: {
    label: "Boys",
    eyebrow: "Know about",
    color: [210, 85, 72],
    members: [
      { name: "Aditya Puspjivi",  photo: "images/boys/aditya.jpg",    quote: "The journey shaped us more than the destination.",         details: { Role: "Student", Class: "2025-26" } },
      { name: "Amit Dubay",       photo: "images/boys/amit.jpg",       quote: "Every day was a new adventure waiting to happen.",          details: { Role: "Student", Class: "2025-26" } },
      { name: "Abhinav dubey",    photo: "images/boys/abhinav.jpg",    quote: "Memories are the only things that grow richer over time.", details: { Role: "Student", Class: "2025-26" } },
      { name: "Ankush Panday",    photo: "images/boys/ankush.jpg",     quote: "We didn't just study — we lived.",                         details: { Role: "Student", Class: "2025-26" } },
      { name: "Ankit Yadav",      photo: "images/boys/ankit.jpg",      quote: "The best chapters of life are written with friends.",       details: { Role: "Student", Class: "2025-26" } },
      { name: "Aryan Dubay",      photo: "images/boys/aryan.jpg",      quote: "Laughter was our secret language.",                        details: { Role: "Student", Class: "2025-26" } },
      { name: "Adarsh Yadav",     photo: "images/boys/adarsh.jpg",     quote: "Every small moment was a big memory in disguise.",          details: { Role: "Student", Class: "2025-26" } },
      { name: "Naman Dubay",      photo: "images/boys/naman.jpg",      quote: "We came as classmates, we leave as family.",               details: { Role: "Student", Class: "2025-26" } },
      { name: "Dipanshu Yadav",   photo: "images/boys/dipanshu.jpg",   quote: "Time flies, but memories stay forever.",                   details: { Role: "Student", Class: "2025-26" } },
      { name: "Raghav Panday",    photo: "images/boys/raghav.jpg",     quote: "The halls echoed our laughter for years.",                 details: { Role: "Student", Class: "2025-26" } },
      { name: "Shubham Yadav",    photo: "images/boys/shubham.jpg",    quote: "Growing up is inevitable; growing together is a gift.",     details: { Role: "Student", Class: "2025-26" } },
      { name: "Harsh Panday",     photo: "images/boys/harsh.jpg",      quote: "Here's to the nights we won't forget.",                    details: { Role: "Student", Class: "2025-26" } },
      { name: "Priyanshu Singh",  photo: "images/boys/priyanshu.jpg",  quote: "Every friend is a different world within us.",             details: { Role: "Student", Class: "2025-26" } },
      { name: "Anmol Patel",      photo: "images/boys/anmol.jpg",      quote: "Made this page so we never forget who we were.",           details: { Role: "Creator & Student", Class: "2025-26" } },
    ]
  },

  girls: {
    label: "Girls",
    eyebrow: "Know about",
    color: [340, 80, 75],
    members: [
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg",  quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
      { name: "Coming soon... ",  photo: "images/girls/girl.jpg", quote: "Coming soon…", details: { Role: "Student", Class: "2025-26" }, placeholder: true },
    ]
  },

  teachers: {
    label: "Teachers",
    eyebrow: "Know about",
    color: [45, 85, 68],
    members: [
      { name: "Mr.Dhruv dutt panday",  photo: "images/teachers/t.jpg",  quote: "Teaching is the greatest act of optimism.",    details: { Subject: "Mathematics",       Experience: "15+ years" } },
      { name: "Mr. Ravi singh",    photo: "images/teachers/t.jpg",  quote: "A teacher affects eternity.",                  details: { Subject: "English",            Experience: "12 years" } },
      { name: "Mr. Pradeep Kumar ",       photo: "images/teachers/t.jpg",  quote: "Science is the poetry of reality.",            details: { Subject: "Physics",            Experience: "18 years" } },
      { name: "Mr. Ayush Singh ",     photo: "images/teachers/t.jpg",  quote: "Chemistry connects everything.",               details: { Subject: "Chemistry",          Experience: "10 years" } },
      { name: "Mr. Deepak tiwari ",   photo: "images/teachers/t.jpg",  quote: "Biology is the study of life itself.",         details: { Subject: "Biology",            Experience: "14 years" } },
      { name: "Mr. Narendra tiwari",   photo: "images/teachers/t.jpg",  quote: "Language is the road map of a culture.",       details: { Subject: "Hindi",              Experience: "16 years" } },
      { name: "Mr. Ashwani shukla",     photo: "images/teachers/t.jpg",  quote: "History is the witness of the times.",         details: { Subject: "Social Science",     Experience: "13 years" } },
      { name: "Mrs. Rekha Shukla",          photo: "images/teachers/t.jpg",  quote: "Sanskrit is the mother of all languages.",     details: { Subject: "Sanskrit",           Experience: "20 years" } },
      { name: "Mr. Ramesh Prasad Dubey",    photo: "images/teachers/t.jpg",  quote: "Code is poetry; every bug is a lesson.",       details: { Subject: "Computer Science",   Experience: "11 years" } },
      { name: "Mrs. Anita Tripathi",        photo: "images/teachers/t.jpg", quote: "Art enables us to find ourselves.",            details: { Subject: "Art & Craft",        Experience: "9 years"  } },
      { name: "Mr. Pradeep Kumar Verma",    photo: "images/teachers/t.jpg", quote: "A healthy body is a healthy mind.",            details: { Subject: "Physical Education", Experience: "17 years" } },
      { name: "Mrs. Sushma Agarwal",        photo: "images/teachers/t.jpg", quote: "Home is where the heart is nurtured.",         details: { Subject: "Home Science",       Experience: "8 years"  } },
      { name: "Mr. Mahesh Chandra Singh",   photo: "images/teachers/t.jpg", quote: "Geography is the eye of history.",             details: { Subject: "Geography",          Experience: "15 years" } },
      { name: "Mrs. Nirmala Srivastava",    photo: "images/teachers/t.jpg", quote: "Those who do not know history are doomed.",    details: { Subject: "History",            Experience: "22 years" } },
      { name: "Mr. Ashok Kumar Patel",      photo: "images/teachers/t.jpg", quote: "Civic duty begins with knowledge.",            details: { Subject: "Civics",             Experience: "12 years" } },
      { name: "Mrs. Pushpa Chauhan",        photo: "images/teachers/t.jpg", quote: "Economics is the science of making choices.",  details: { Subject: "Economics",          Experience: "14 years" } },
      { name: "Mr. Dhirendra Nath Joshi",   photo: "images/teachers/t.jpg", quote: "Commerce drives the world forward.",           details: { Subject: "Commerce",           Experience: "16 years" } },
      { name: "Mrs. Usha Rani Pandey",      photo: "images/teachers/t.jpg", quote: "Music is the universal language of mankind.",  details: { Subject: "Music",              Experience: "19 years" } },
      { name: "Mr. Santosh Kumar Mishra",   photo: "images/teachers/t.jpg", quote: "Art speaks where words are unable to explain.",details: { Subject: "Drawing",            Experience: "11 years" } },
      { name: "Mrs. Geeta Devi Yadav",      photo: "images/teachers/t.jpg", quote: "Nature is the greatest teacher of all.",       details: { Subject: "Environmental Sc.",  Experience: "13 years" } },
      { name: "Mr. Hemant Kumar Sharma",    photo: "images/teachers/t.jpg", quote: "Numbers never lie if you read them right.",    details: { Subject: "Mathematics II",     Experience: "10 years" } },
      { name: "Mrs. Vandana Tiwari",        photo: "images/teachers/t.jpg", quote: "Literature is the art of discovering humanity.",details: { Subject: "English Literature", Experience: "15 years" } },
      { name: "Mr. Prakash Narayan Singh",  photo: "images/teachers/t.jpg", quote: "Every experiment teaches us something new.",   details: { Subject: "Physics II",         Experience: "12 years" } },
      { name: "Mrs. Seema Gupta",           photo: "images/teachers/t.jpg", quote: "Reactions in life — just like in chemistry.",  details: { Subject: "Chemistry II",       Experience: "9 years"  } },
      { name: "Mr. Naresh Kumar Shukla",    photo: "images/teachers/t.jpg", quote: "Life science is the science of life.",         details: { Subject: "Biology II",         Experience: "14 years" } },
      { name: "Mrs. Lata Devi Tripathi",    photo: "images/teachers/t.jpg", quote: "Hindi ke bina Bharat adhura hai.",             details: { Subject: "Hindi Literature",   Experience: "18 years" } },
      { name: "Mr. Shyam Sundar Pandey",    photo: "images/teachers/t.jpg", quote: "Society is built on the shoulders of students.",details: { Subject: "Social Studies",    Experience: "16 years" } },
      { name: "Mrs. Savitri Devi Singh",    photo: "images/teachers/t.jpg", quote: "Devbhasha Sanskrit — the language of gods.",   details: { Subject: "Sanskrit II",        Experience: "21 years" } },
      { name: "Mr. Rajan Kumar Verma",      photo: "images/teachers/t.jpg", quote: "Technology is a tool; wisdom is the key.",     details: { Subject: "Computer Applications", Experience: "8 years" } },
      { name: "Mrs. Madhuri Agarwal",       photo: "images/teachers/t.jpg", quote: "Knowledge is the only wealth that grows.",     details: { Subject: "General Knowledge",  Experience: "11 years" } },
    ]
  },

  school: {
    label: "School",
    eyebrow: "Know about",
    color: [155, 65, 58],
    members: [
      { name: "Main Building",     photo: "images/school/school.jpg", quote: "These walls hold a thousand stories.",        details: { Type: "Academic Block",   Year: "Est. 1985" } },
      { name: "The Library",       photo: "images/school/school.jpg", quote: "A room without books is a body without soul.",details: { Type: "Knowledge Centre", Year: "Renovated 2019" } },
      { name: "Science Lab",       photo: "images/school/school.jpg", quote: "Where curiosity becomes discovery.",          details: { Type: "Laboratory",       Year: "Upgraded 2022" } },
      { name: "The Playground",    photo: "images/school/school.jpg", quote: "Champions are made here.",                   details: { Type: "Sports Ground",    Year: "Since 1985" } },
      { name: "Assembly Hall",     photo: "images/school/school.jpg", quote: "Every morning began with a promise.",        details: { Type: "Auditorium",       Year: "Capacity: 500" } },
      { name: "Computer Lab",      photo: "images/school/school.jpg", quote: "The future was coded in this room.",         details: { Type: "IT Centre",        Year: "Est. 2010" } },
    ]
  }
};

/* ============================================================
   2. THEME TOGGLE
   ============================================================ */
(function ThemeToggle() {
  const btn  = document.getElementById('themeToggle');
  const root = document.documentElement;

  const saved = localStorage.getItem('theme') || 'light';
  root.setAttribute('data-theme', saved);
  if (btn) btn.textContent = saved === 'dark' ? '☀' : '◐';

  if (!btn) return;
  btn.addEventListener('click', () => {
    const current = root.getAttribute('data-theme') || 'light';
    const next    = current === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    btn.textContent = next === 'dark' ? '☀' : '◐';
    root.classList.add('theme-transitioning');
    setTimeout(() => root.classList.remove('theme-transitioning'), 600);
  });
})();

/* ============================================================
   3. FOG ENGINE — Reusable factory for any canvas element
   ============================================================ */
function createFogEngine(canvasEl, options = {}) {
  const ctx = canvasEl.getContext("2d");
  const {
    colorStops    = [[196,62,84],[270,52,86],[18,68,88],[155,46,84],[330,48,88]],
    particleCount = 42,
    bright        = false,
    alphaScale    = 1,
    interactive   = false
  } = options;

  let W, H;
  function resize() {
    W = canvasEl.width  = canvasEl.offsetWidth  || canvasEl.parentElement?.offsetWidth  || 800;
    H = canvasEl.height = canvasEl.offsetHeight || canvasEl.parentElement?.offsetHeight || 600;
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvasEl);

  let colorT = 0;

  function lerp(a, b, t) {
    return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t];
  }

  function fogColor(alpha) {
    const n = colorStops.length;
    const s = colorT * n;
    const i = Math.floor(s) % n;
    const j = (i + 1) % n;
    const [h,sat,l] = lerp(colorStops[i], colorStops[j], s - Math.floor(s));
    const fs = bright ? Math.min(sat * 1.7, 100) : sat;
    const fl = bright ? Math.min(l * 1.08, 95)   : l;
    return `hsla(${h.toFixed(1)},${fs.toFixed(1)}%,${fl.toFixed(1)}%,${alpha})`;
  }

  function makeParticle() {
    return {
      x:     Math.random() * (W || 800),
      y:     Math.random() * (H || 600),
      r:     (bright ? 180 : 110) + Math.random() * 220,
      vx:    (Math.random() - 0.5) * (bright ? 0.32 : 0.22),
      vy:    (Math.random() - 0.5) * (bright ? 0.26 : 0.18),
      phase: Math.random() * Math.PI * 2,
      speed: 0.0003 + Math.random() * 0.0005,
      alpha: (bright ? 0.13 : 0.055) + Math.random() * (bright ? 0.2 : 0.11),
    };
  }

  const particles = Array.from({ length: particleCount }, makeParticle);
  let cursor = { x: -9999, y: -9999 };
  let disperseR = 0, dispersing = false, refillTimer = null;
  const DMAX = 170;

  function onPointer(e) {
    const rect = canvasEl.getBoundingClientRect();
    cursor.x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    cursor.y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    dispersing = true;
    clearTimeout(refillTimer);
    refillTimer = setTimeout(() => { dispersing = false; }, 2200);
  }

  if (interactive) {
    canvasEl.addEventListener("mousemove", onPointer, { passive: true });
    canvasEl.addEventListener("touchmove", onPointer, { passive: true });
  }

  let running = true, lastTime = 0;

  function render(now) {
    if (!running) return;
    requestAnimationFrame(render);
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;
    colorT = (colorT + dt * 0.000052) % 1;

    if (dispersing) disperseR = Math.min(disperseR + 20, DMAX);
    else            disperseR = Math.max(disperseR - 2, 0);

    ctx.clearRect(0, 0, W, H);

    particles.forEach(p => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x >  W + p.r) p.x = -p.r;
      if (p.x < -p.r)     p.x =  W + p.r;
      if (p.y >  H + p.r) p.y = -p.r;
      if (p.y < -p.r)     p.y =  H + p.r;

      const bx = Math.sin(now * p.speed + p.phase) * 20;
      const by = Math.cos(now * p.speed * 0.7 + p.phase) * 14;
      const dx = p.x + bx, dy = p.y + by;

      let am = alphaScale;
      if (disperseR > 0) {
        const dist = Math.hypot(dx - cursor.x, dy - cursor.y);
        if (dist < disperseR + p.r) {
          const inf = Math.max(0, 1 - dist / (disperseR + p.r * 0.5));
          am *= (1 - inf * 0.96);
        }
      }
      if (am < 0.01) return;

      const g = ctx.createRadialGradient(dx, dy, 0, dx, dy, p.r);
      g.addColorStop(0,   fogColor(p.alpha * am));
      g.addColorStop(0.5, fogColor(p.alpha * am * 0.55));
      g.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(dx, dy, p.r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });

    // Vignette
    const vig = ctx.createRadialGradient(W*.5,H*.5,Math.min(W,H)*.2, W*.5,H*.5,Math.max(W,H)*.82);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, fogColor(bright ? 0.38 : 0.24));
    ctx.fillStyle = vig;
    ctx.fillRect(0,0,W,H);
  }

  requestAnimationFrame(render);
  return { stop: () => { running = false; ro.disconnect(); } };
}

/* ============================================================
   4. HERO FOG + ORIGINAL EFFECTS
   ============================================================ */
(function HeroFog() {
  const canvas = document.getElementById("fogCanvas");
  if (canvas) createFogEngine(canvas, {
    interactive:  true,
    bright:       true,
    alphaScale:   0.9,
    particleCount: 50,
    colorStops: [
      [196, 70, 82], [280, 60, 86], [18, 75, 84], [155, 55, 80], [330, 65, 85]
    ]
  });
})();

(function NavScroll() {
  const nav = document.getElementById("mainNav");
  if (!nav) return;
  function onScroll() { nav.classList.toggle("nav--scrolled", window.scrollY > 40); }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

(function RevealObserver() {
  const obs = new IntersectionObserver(
    entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); }
    }),
    { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
})();

(function HeroParallax() {
  const bg = document.getElementById("heroBg");
  if (!bg || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let tick = false;
  window.addEventListener("scroll", () => {
    if (!tick) {
      requestAnimationFrame(() => {
        bg.style.transform = `translateY(${window.scrollY * 0.18}px)`;
        tick = false;
      });
      tick = true;
    }
  }, { passive: true });
})();

(function SmoothAnchors() {
  const NAV_H = 72;
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener("click", e => {
      const t = document.querySelector(link.getAttribute("href"));
      if (!t) return;
      e.preventDefault();
      window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - NAV_H, behavior: "smooth" });
    });
  });
})();

/* ============================================================
   5. FAMILY SECTION — Vivid fog on section canvas
   ============================================================ */
(function FamilyFog() {
  const canvas = document.getElementById("familyFogCanvas");
  if (!canvas) return;
  createFogEngine(canvas, {
    bright: true, alphaScale: 1.3, particleCount: 55,
    colorStops: [
      [210, 100, 75], [280, 95, 80], [18, 100, 78], [155, 85, 70], [340, 90, 78]
    ]
  });
})();

/* ============================================================
   6. DIRECTORY OVERLAY — Category → Name Grid
   ============================================================ */
const dirOverlay   = document.getElementById("directoryOverlay");
const dirTitle     = document.getElementById("dirTitle");
const dirEyebrow   = document.getElementById("dirEyebrow");
const dirNameGrid  = document.getElementById("dirNameGrid");
const dirClose     = document.getElementById("dirClose");
const dirFogCanvas = document.getElementById("dirFogCanvas");

let dirFogEngine   = null;

/* ─── Merge Firestore member names for girls/teachers ───────── */
async function getMergedMembers(categoryKey) {
  const base = FAMILY_DATA[categoryKey].members.map((m, i) => ({ ...m, _localIdx: i }));
  if (categoryKey !== "girls" && categoryKey !== "teachers") return base;

  try {
    const role    = categoryKey === "girls" ? "girl" : "teacher";
    const usersSnap = await getDocs(collection(db, "users"));
    const registered = [];
    usersSnap.forEach(d => {
      const u = d.data();
      if (u.role === role && u.profileComplete && !u.banned) registered.push(u);
    });
    // Fill placeholder slots with registered users
    let regIdx = 0;
    return base.map(m => {
      if (m.placeholder && regIdx < registered.length) {
        const u = registered[regIdx++];
        return { ...m, name: u.name, placeholder: false, _uid: u.uid };
      }
      return m;
    });
  } catch { return base; }
}

async function openDirectory(categoryKey) {
  const cat = FAMILY_DATA[categoryKey];
  if (!cat) return;

  dirTitle.textContent   = cat.label;
  dirEyebrow.textContent = cat.eyebrow;
  dirNameGrid.innerHTML  = `<p style="color:var(--clr-muted);padding:2rem">Loading…</p>`;

  dirOverlay.hidden = false;
  document.body.style.overflow = "hidden";

  if (dirFogEngine) dirFogEngine.stop();
  const [h, s, l] = cat.color;
  dirFogEngine = createFogEngine(dirFogCanvas, {
    bright: true, alphaScale: 1.2, particleCount: 50,
    colorStops: [
      [h, s, l],
      [(h + 30) % 360, s * .85, l + 5],
      [(h + 60) % 360, s * .7,  l + 8],
      [(h - 30 + 360) % 360, s, l - 5],
    ]
  });
  dirFogCanvas.style.width  = "100vw";
  dirFogCanvas.style.height = "100vh";

  const members = await getMergedMembers(categoryKey);
  dirNameGrid.innerHTML = "";
  members.forEach((member, i) => {
    const btn = document.createElement("button");
    btn.className = "dir-name-btn";
    if (member.placeholder) btn.classList.add("dir-name-btn--placeholder");
    btn.style.setProperty("--ni", `${i * 0.04}s`);
    btn.innerHTML = `
      <span class="dir-name-btn__number">${String(i + 1).padStart(2, "0")}</span>
      <span class="dir-name-btn__name">${member.name}</span>
    `;
    btn.addEventListener("click", () => openProfile(categoryKey, i, members));
    dirNameGrid.appendChild(btn);
  });
}

function closeDirectory() {
  dirOverlay.hidden = true;
  document.body.style.overflow = "";
  if (dirFogEngine) { dirFogEngine.stop(); dirFogEngine = null; }
}

dirClose?.addEventListener("click", closeDirectory);
dirOverlay?.addEventListener("click", e => { if (e.target === dirOverlay) closeDirectory(); });

document.getElementById("familyCategories")?.addEventListener("click", e => {
  const card = e.target.closest(".family-cat-card");
  if (card) openDirectory(card.dataset.category);
});

/* ============================================================
   7. PROFILE OVERLAY — Individual Member Card
   ============================================================ */
const profileOverlay   = document.getElementById("profileOverlay");
const profileName      = document.getElementById("profileName");
const profileCategory  = document.getElementById("profileCategory");
const profileDetails   = document.getElementById("profileDetails");
const profileQuote     = document.getElementById("profileQuote");
const profileInitials  = document.getElementById("profileInitials");
const profilePhoto     = document.getElementById("profilePhoto");
const profileGlow      = document.getElementById("profileGlow");
const profileFogCanvas = document.getElementById("profileFogCanvas");
const profileClose     = document.getElementById("profileClose");

let profileFogEngine = null;

function getInitials(name) {
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}

function openProfile(categoryKey, idx, members) {
  const cat    = FAMILY_DATA[categoryKey];
  const member = (members || cat.members)[idx];

  profileName.textContent     = member.name;
  profileCategory.textContent = `${cat.eyebrow} ${cat.label}`;
  profileInitials.textContent = getInitials(member.name);
  profileQuote.textContent    = member.quote;

  profileDetails.innerHTML = "";
  Object.entries(member.details).forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "profile-detail-row";
    row.innerHTML = `<span class="profile-detail-label">${label}</span><span class="profile-detail-value">${value}</span>`;
    profileDetails.appendChild(row);
  });

  profilePhoto.classList.remove("loaded");
  profilePhoto.src = "";
  const img = new Image();
  img.onload = () => {
    profilePhoto.src = img.src;
    profilePhoto.alt = member.name;
    setTimeout(() => profilePhoto.classList.add("loaded"), 10);
  };
  img.src = member.photo;

  const [h, s, l] = cat.color;
  profileGlow.style.setProperty("--glow-color", `hsla(${h},${s}%,${l}%,0.35)`);

  profileOverlay.hidden = false;
  document.body.style.overflow = "hidden";

  if (profileFogEngine) profileFogEngine.stop();
  profileFogEngine = createFogEngine(profileFogCanvas, {
    bright: true, alphaScale: 0.8, particleCount: 35,
    colorStops: [
      [h, s, l],
      [(h + 40) % 360, s * .8, l + 8],
      [(h - 40 + 360) % 360, s * .9, l - 5],
    ]
  });
  profileFogCanvas.style.width  = "100vw";
  profileFogCanvas.style.height = "100vh";
}

function closeProfile() {
  profileOverlay.hidden = true;
  document.body.style.overflow = "hidden";
  if (profileFogEngine) { profileFogEngine.stop(); profileFogEngine = null; }
}

profileClose?.addEventListener("click", closeProfile);
profileOverlay?.addEventListener("click", e => { if (e.target === profileOverlay) closeProfile(); });

/* ============================================================
   8. KEYBOARD ESC
   ============================================================ */
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!profileOverlay?.hidden)  closeProfile();
    else if (!dirOverlay?.hidden) closeDirectory();
  }
});
