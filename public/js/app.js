/**
 * HeartSync Frontend Engine
 * Handles Socket.io events, Web Audio API sound synthesis, 
 * canvas physics rendering, combos, and touch-gestures.
 */

// Initialize Socket.io
const socket = io();

// State Variables
let currentRoomId = null;
let isPartnerConnected = false;
let myHoldActive = false;
let partnerHoldActive = false;
let pinCodeInput = "";
let heartbeatIntervalId = null;
let socketId = null;

// Combo Mechanics
let lastTapTime = 0;
let tapComboCount = 0;
const COMBO_DECAY_MS = 2000;
let comboDecayTimer = null;
let comboBarProgress = 0; // 0 to 100

// Canvas Physics Elements
const canvas = document.getElementById('canvas-display');
const ctx = canvas.getContext('2d');
let particles = [];
let sparkles = [];

// ==========================================================================
// AUDIO ENGINE (Web Audio API Synthesizer)
// Real-time sound generation (Zero assets required)
// ==========================================================================
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const SoundSynth = {
  // Classic Heart: Cute warm pluck
  playClassic() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    // Fast frequency sweep down for "cute bubble" sound
    osc.frequency.setValueAtTime(280, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.12);
    
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.16);
  },

  // Sparkle Heart: Twinkling magical chime
  playSparkle() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Play multiple high-pitched chime tones
    const freqs = [880, 1174, 1318];
    
    freqs.forEach((f, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, now + index * 0.03);
      
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(500, now);
      
      gain.gain.setValueAtTime(0.07, now + index * 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.03 + 0.25);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + index * 0.03);
      osc.stop(now + index * 0.03 + 0.3);
    });
  },

  // Fire Heart: Crackly frequency pop
  playFire() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
    
    // Low pass sweep to create a warm "woosh"
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + 0.12);
    
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.16);
  },

  // Broken Heart: Hollow snap/pop
  playBroken() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(50, now + 0.08);
    
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, now);
    
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.1);
  },

  // Sub-Bass Heartbeat: Dual rhythmic thump (Lub-Dub)
  playHeartbeat(isSynced = false) {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const baseFreq = isSynced ? 65 : 55;
    const vol = isSynced ? 0.8 : 0.55;
    
    // First beat ("Lub")
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(25, now + 0.08);
    
    gain1.gain.setValueAtTime(vol, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);
    
    // Second beat ("Dub") - 150ms later
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 0.9, now + 0.14);
    osc2.frequency.exponentialRampToValueAtTime(20, now + 0.22);
    
    gain2.gain.setValueAtTime(vol * 0.7, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.26);
  },

  // Combo Storm: Cascade chime sound
  playStorm() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    // Trigger 8 notes rapidly
    const scale = [523.25, 587.33, 659.25, 698.46, 783.99, 880.00, 987.77, 1046.50]; // C5 to C6
    scale.forEach((freq, i) => {
      const timeOffset = i * 0.05;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + timeOffset);
      
      gain.gain.setValueAtTime(0.08, now + timeOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + timeOffset + 0.18);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now + timeOffset);
      osc.stop(now + timeOffset + 0.2);
    });
  },

  // Panda squeak: Adorable happy boing
  playPanda() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    // Squeaky sweep up
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.1);
    
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.15);
  }
};

// ==========================================================================
// HAPTIC FEEDBACK ENGINE
// Web Vibrations for tactile feedback on mobile devices
// ==========================================================================
const Haptics = {
  vibrate(pattern) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Suppress errors (some browsers restrict vibrations)
      }
    }
  },
  tap() { this.vibrate(10); },
  success() { this.vibrate([40, 60, 40]); },
  heartbeat() { this.vibrate([60, 100, 40]); },
  doubleHeartbeat() { this.vibrate([80, 80, 80, 80]); },
  storm() { this.vibrate([50, 30, 50, 30, 50, 30, 100]); }
};

// ==========================================================================
// CANVAS PHYSICS RENDER ENGINE
// Dynamic floating heart physics engine with smooth trails
// ==========================================================================

class HeartParticle {
  constructor(x, y, type = 'classic', textNote = null) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.textNote = textNote; // encapsulated message
    this.vx = (Math.random() - 0.5) * 2; // initial horizontal speed
    this.vy = - (Math.random() * 2.5 + 2); // initial vertical rising speed
    this.size = Math.random() * 15 + 22; // base size
    this.alpha = 1;
    this.decay = Math.random() * 0.005 + 0.008; // slow fadeout
    this.wobbleSpeed = Math.random() * 0.05 + 0.03;
    this.wobbleRange = Math.random() * 1.5 + 1;
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.lifetime = 0;
    
    // Assign specific characteristics based on Type
    switch (type) {
      case 'sparkle':
        this.color = `hsl(${Math.random() * 30 + 280}, 95%, 68%)`; // Lavender pinks
        this.vy *= 1.1;
        break;
      case 'fire':
        this.color = `hsl(${Math.random() * 20 + 10}, 100%, 55%)`; // Blazing red-oranges
        this.vy *= 1.7; // Rises extremely fast
        break;
      case 'broken':
        this.color = '#726f7f'; // Ashen purple
        this.vx = (Math.random() - 0.5) * 4;
        this.vy *= 0.6; // Rises slowly, then drops
        this.gravity = 0.08;
        this.brokenSplit = 0; // split separation width
        break;
      case 'envelope':
        this.color = '#ffcc00'; // Glowing yellow note
        this.size = 35;
        this.vx = (Math.random() - 0.5) * 1.5;
        this.vy = - (Math.random() * 1.2 + 1.2); // Slow rising float
        this.interactive = true;
        break;
      case 'panda':
        this.color = '#90e0ef'; // Pastel blue sparks
        this.size = Math.random() * 10 + 30; // Large cute panda face
        this.vx = (Math.random() - 0.5) * 3;
        this.vy = - (Math.random() * 2 + 1.8);
        this.wobbleSpeed = Math.random() * 0.08 + 0.04;
        this.wobbleRange = Math.random() * 2 + 1.5;
        break;
      default: // classic
        this.color = `hsl(${Math.random() * 10 + 348}, 95%, 58%)`; // Classic vibrant pink-red
    }
  }

  update() {
    this.lifetime++;
    this.x += this.vx;
    this.y += this.vy;
    
    // Add custom physics behavior
    if (this.type === 'broken') {
      if (this.vy < 3) this.vy += this.gravity; // Gravity pull downwards
      this.brokenSplit += 0.25; // Drifting apart
    } else {
      // Horizontal float wobble
      this.x += Math.sin(this.lifetime * this.wobbleSpeed + this.wobblePhase) * this.wobbleRange * 0.5;
    }

    // Slowly reduce opacity
    this.alpha -= this.decay;

    // Trail creation for specific particles
    if (this.alpha > 0.25) {
      if (this.type === 'sparkle' && Math.random() < 0.22) {
        sparkles.push(new SparkleParticle(this.x, this.y, this.color));
      } else if (this.type === 'fire' && Math.random() < 0.4) {
        sparkles.push(new SparkleParticle(this.x, this.y, this.color, true));
      }
    }
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.translate(this.x, this.y);

    if (this.type === 'envelope') {
      // Draw special secret note envelope
      this.drawEnvelope();
    } else if (this.type === 'broken') {
      // Draw split heart halves
      this.drawBrokenHeart();
    } else if (this.type === 'panda') {
      // Render cute panda emoji
      ctx.font = `${this.size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🐼', 0, 0);
    } else {
      // Draw smooth solid heart path
      this.drawSolidHeart();
    }

    ctx.restore();
  }

  drawSolidHeart() {
    ctx.beginPath();
    ctx.fillStyle = this.color;
    ctx.shadowBlur = this.type === 'fire' ? 18 : 8;
    ctx.shadowColor = this.color;
    
    const s = this.size;
    ctx.moveTo(0, s * 0.25);
    ctx.bezierCurveTo(0, s * 0.28, - s * 0.55, - s * 0.25, - s * 0.55, - s * 0.65);
    ctx.bezierCurveTo(- s * 0.55, - s * 1.05, 0, - s * 1.05, 0, - s * 0.35);
    ctx.bezierCurveTo(0, - s * 1.05, s * 0.55, - s * 1.05, s * 0.55, - s * 0.65);
    ctx.bezierCurveTo(s * 0.55, - s * 0.25, 0, s * 0.28, 0, s * 0.25);
    ctx.fill();
    ctx.closePath();
  }

  drawBrokenHeart() {
    const s = this.size;
    ctx.shadowBlur = 4;
    ctx.shadowColor = '#000000';
    ctx.fillStyle = this.color;

    // Draw Left Half (drifts left)
    ctx.save();
    ctx.translate(-this.brokenSplit, 0);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.25);
    ctx.bezierCurveTo(0, s * 0.28, - s * 0.55, - s * 0.25, - s * 0.55, - s * 0.65);
    ctx.bezierCurveTo(- s * 0.55, - s * 1.05, 0, - s * 1.05, 0, - s * 0.35);
    ctx.lineTo(0, s * 0.25);
    ctx.fill();
    ctx.restore();

    // Draw Right Half (drifts right)
    ctx.save();
    ctx.translate(this.brokenSplit, 0);
    ctx.beginPath();
    ctx.moveTo(0, - s * 0.35);
    ctx.bezierCurveTo(0, - s * 1.05, s * 0.55, - s * 1.05, s * 0.55, - s * 0.65);
    ctx.bezierCurveTo(s * 0.55, - s * 0.25, 0, s * 0.28, 0, s * 0.25);
    ctx.lineTo(0, - s * 0.35);
    ctx.fill();
    ctx.restore();
  }

  drawEnvelope() {
    const s = this.size;
    ctx.shadowBlur = 15;
    ctx.shadowColor = 'rgba(255, 204, 0, 0.4)';
    
    // Draw outer paper envelope
    ctx.fillStyle = '#1e1a33';
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2;
    
    // Envelope rectangular body
    ctx.beginPath();
    ctx.rect(-s*0.7, -s*0.5, s*1.4, s);
    ctx.fill();
    ctx.stroke();
    
    // Envelope flap lines
    ctx.beginPath();
    ctx.moveTo(-s*0.7, -s*0.5);
    ctx.lineTo(0, s*0.05);
    ctx.lineTo(s*0.7, -s*0.5);
    ctx.stroke();
    
    // Sealing heart
    ctx.beginPath();
    ctx.fillStyle = '#ff2d55';
    const hs = s * 0.3;
    ctx.translate(0, s*0.05);
    ctx.moveTo(0, hs * 0.25);
    ctx.bezierCurveTo(0, hs * 0.28, - hs * 0.55, - hs * 0.25, - hs * 0.55, - hs * 0.65);
    ctx.bezierCurveTo(- hs * 0.55, - hs * 1.05, 0, - hs * 1.05, 0, - hs * 0.35);
    ctx.bezierCurveTo(0, - hs * 1.05, hs * 0.55, - hs * 1.05, hs * 0.55, - hs * 0.65);
    ctx.bezierCurveTo(hs * 0.55, - hs * 0.25, 0, hs * 0.28, 0, hs * 0.25);
    ctx.fill();
  }
}

// Sparkle/Ember tail particles
class SparkleParticle {
  constructor(x, y, color, isEmber = false) {
    this.x = x + (Math.random() - 0.5) * 15;
    this.y = y + (Math.random() - 0.5) * 15;
    this.color = color;
    this.size = Math.random() * (isEmber ? 4 : 3) + 1;
    this.alpha = 1;
    this.decay = Math.random() * 0.02 + 0.03;
    this.vx = (Math.random() - 0.5) * 1;
    this.vy = isEmber ? (Math.random() * 1.5 - 0.5) : (Math.random() * 0.5);
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.alpha -= this.decay;
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.fillStyle = this.color;
    ctx.beginPath();
    // Round sparks or square starry pixels
    if (Math.random() < 0.3) {
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    } else {
      ctx.rect(this.x - this.size/2, this.y - this.size/2, this.size, this.size);
    }
    ctx.fill();
    ctx.restore();
  }
}

// Set full canvas boundaries
function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.scale(dpr, dpr);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Animation Update Cycle (60fps)
function drawLoop() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // Update & Draw Sparkles
  for (let i = sparkles.length - 1; i >= 0; i--) {
    sparkles[i].update();
    if (sparkles[i].alpha <= 0) {
      sparkles.splice(i, 1);
    } else {
      sparkles[i].draw();
    }
  }

  // Update & Draw Hearts
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    if (particles[i].alpha <= 0) {
      particles.splice(i, 1);
    } else {
      particles[i].draw();
    }
  }

  requestAnimationFrame(drawLoop);
}
requestAnimationFrame(drawLoop);

// Trigger a local visual emitter
function spawnHeartLocally(x, y, type = 'classic', textNote = null) {
  // Spawn main particle
  particles.push(new HeartParticle(x, y, type, textNote));
  
  // Audio Feedback based on type
  if (type === 'classic') SoundSynth.playClassic();
  else if (type === 'sparkle') SoundSynth.playSparkle();
  else if (type === 'fire') SoundSynth.playFire();
  else if (type === 'broken') SoundSynth.playBroken();
  else if (type === 'envelope') SoundSynth.playSparkle();
  else if (type === 'panda') SoundSynth.playPanda();
}

// Generate an explosive storm of hearts
function triggerHeartStorm(isPartner = false) {
  SoundSynth.playStorm();
  Haptics.storm();

  const count = 40; // Slightly more for panda party!
  const startX = window.innerWidth / 2;
  const startY = window.innerHeight * (isPartner ? 0.2 : 0.85);

  const heartTypes = ['classic', 'sparkle', 'fire', 'panda'];

  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const type = heartTypes[Math.floor(Math.random() * heartTypes.length)];
      const x = startX + (Math.random() - 0.5) * 80;
      const y = startY + (Math.random() - 0.5) * 50;
      const particle = new HeartParticle(x, y, type);
      // Give particles highly scattered velocities for explosive effect
      particle.vx = (Math.random() - 0.5) * 12;
      particle.vy = - (Math.random() * 8 + 6);
      particle.size = Math.random() * 12 + 18;
      particles.push(particle);
    }, i * 30);
  }
}

// ==========================================================================
// COMBO SYSTEM IMPLEMENTATION
// Rapid taps rewards combos and triggers massive storms
// ==========================================================================
function registerTapForCombo() {
  const now = Date.now();
  
  if (comboDecayTimer) clearTimeout(comboDecayTimer);

  if (now - lastTapTime < 800) {
    tapComboCount++;
  } else {
    tapComboCount = 1;
  }
  
  lastTapTime = now;

  // Visual combo progress
  const comboFill = document.getElementById('combo-fill');
  const comboMultiplier = document.getElementById('combo-multiplier');
  const comboContainer = document.querySelector('.combo-meter-container');
  const stormText = document.getElementById('combo-storm-text');

  comboContainer.classList.add('active');
  
  // Scale score difficulty (100 taps trigger storm)
  comboBarProgress = Math.min(100, tapComboCount * 4);
  comboFill.style.width = `${comboBarProgress}%`;
  
  // Calculate multiplier tier
  let mult = "1.0x";
  if (tapComboCount > 20) mult = "5.0x 🔥";
  else if (tapComboCount > 12) mult = "3.5x ✨";
  else if (tapComboCount > 5) mult = "2.0x 💖";
  comboMultiplier.innerText = mult;

  // Storm threshold reached!
  if (comboBarProgress >= 100) {
    tapComboCount = 0;
    stormText.style.display = 'block';
    
    // Dispatch storm event
    triggerHeartStorm(false);
    socket.emit('send-heart', { type: 'storm', intensity: 3, combo: 100 });
    
    setTimeout(() => {
      stormText.style.display = 'none';
      comboContainer.classList.remove('active');
    }, 2000);
  }

  // Decay timer: if user stops tapping, fade combo out
  comboDecayTimer = setTimeout(() => {
    tapComboCount = 0;
    comboBarProgress = 0;
    comboContainer.classList.remove('active');
  }, COMBO_DECAY_MS);
}


// ==========================================================================
// HEARTBEAT SYNC CONTINUOUS HOLD ENGINE
// Synchronizes rhythmic heart beats and tactile sensations
// ==========================================================================

function updateHeartbeatSyncState() {
  const pad = document.getElementById('btn-heartbeat-pad');
  
  if (myHoldActive && partnerHoldActive) {
    // Both holding - Synced Mode Active!
    pad.classList.add('synced');
    document.body.style.animation = 'pulsing-bg 0.66s infinite alternate ease-in-out';
    document.getElementById('hud-prompt-msg').innerText = "Sync Active! Feeling heartbeats... ❤️";
    
    // Continuous heartbeat loop (approx 90 BPM)
    if (!heartbeatIntervalId) {
      SoundSynth.playHeartbeat(true);
      Haptics.doubleHeartbeat();
      
      heartbeatIntervalId = setInterval(() => {
        SoundSynth.playHeartbeat(true);
        Haptics.doubleHeartbeat();
      }, 660);
    }
  } else {
    // Single or zero hold - Reset Sync Mode
    pad.classList.remove('synced');
    document.body.style.animation = 'none';
    document.body.style.backgroundColor = 'var(--bg-dark)';
    
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }

    if (myHoldActive) {
      document.getElementById('hud-prompt-msg').innerText = "Holding... Waiting for partner to hold!";
    } else if (partnerHoldActive) {
      document.getElementById('hud-prompt-msg').innerText = "Partner is holding the pad! Touch yours!";
    } else {
      document.getElementById('hud-prompt-msg').innerText = "Taps send hearts. Sync hold below!";
    }
  }
}

// Setup holding events for mobile and desktop compatibility
function initHeartbeatPad() {
  const pad = document.getElementById('btn-heartbeat-pad');

  const startHold = (e) => {
    e.preventDefault();
    if (myHoldActive) return;
    myHoldActive = true;
    pad.classList.add('holding');
    SoundSynth.playHeartbeat(false);
    Haptics.tap();
    
    // Broadcast hold status to partner
    socket.emit('heartbeat-hold');
    updateHeartbeatSyncState();
  };

  const endHold = (e) => {
    e.preventDefault();
    if (!myHoldActive) return;
    myHoldActive = false;
    pad.classList.remove('holding');
    
    // Broadcast release status to partner
    socket.emit('heartbeat-release');
    updateHeartbeatSyncState();
  };

  // Support multi-touch mobile & standard mouse pointers
  pad.addEventListener('touchstart', startHold, { passive: false });
  pad.addEventListener('touchend', endHold, { passive: false });
  pad.addEventListener('touchcancel', endHold, { passive: false });
  
  pad.addEventListener('mousedown', startHold);
  pad.addEventListener('mouseup', endHold);
  pad.addEventListener('mouseleave', endHold);
}

// ==========================================================================
// SECRET NOTES (MESSAGE BOX OVERLAYS)
// Packaging love notes into interactive envelope particles
// ==========================================================================
const NoteSystem = {
  init() {
    const floatBtn = document.getElementById('btn-secret-msg');
    const composerModal = document.getElementById('modal-secret-note');
    const cancelBtn = document.getElementById('btn-cancel-note');
    const sendBtn = document.getElementById('btn-send-note');
    const inputArea = document.getElementById('input-secret-note');
    
    // Display Composer
    floatBtn.addEventListener('click', () => {
      Haptics.tap();
      composerModal.classList.add('open');
      inputArea.focus();
    });

    // Cancel Composer
    cancelBtn.addEventListener('click', () => {
      Haptics.tap();
      composerModal.classList.remove('open');
      inputArea.value = '';
    });

    // Send Note Event
    sendBtn.addEventListener('click', () => {
      const msg = inputArea.value.trim();
      if (!msg) return;

      Haptics.success();
      
      // Local canvas visual envelope spawn
      spawnHeartLocally(window.innerWidth / 2, window.innerHeight * 0.8, 'envelope', msg);
      
      // Dispatch envelope to partner
      socket.emit('send-heart', {
        type: 'envelope',
        textNote: msg
      });

      // Clear & Close
      composerModal.classList.remove('open');
      inputArea.value = '';
    });

    // Setup Close Listener for Reader
    document.getElementById('btn-close-note').addEventListener('click', () => {
      Haptics.tap();
      document.getElementById('modal-read-note').classList.remove('open');
    });

    // Canvas click interceptor to check for popped envelope particles!
    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Find if clicked near a floating envelope
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.type === 'envelope') {
          // Approximate hit check radius
          const distance = Math.hypot(p.x - clickX, p.y - clickY);
          if (distance < p.size * 1.5) {
            // Clicked! Pop particle with sound effect and reveal modal
            Haptics.success();
            SoundSynth.playStorm();
            
            // Spawn explosion sparkles
            for (let s = 0; s < 15; s++) {
              sparkles.push(new SparkleParticle(p.x, p.y, '#ffcc00'));
            }
            
            // Remove particle
            particles.splice(i, 1);

            // Open Reader Modal showing letter content
            document.getElementById('display-secret-note').innerText = `"${p.textNote}"`;
            document.getElementById('modal-read-note').classList.add('open');
            break;
          }
        }
      }
    });
  }
};

// ==========================================================================
// USER INTERFACES & ROOM COORDINATION
// Panel manipulation and web-socket triggers
// ==========================================================================

// Global DOM references
const lobbyScreen = document.getElementById('lobby-screen');
const syncScreen = document.getElementById('sync-screen');
const drawerCreate = document.getElementById('drawer-create');
const drawerJoin = document.getElementById('drawer-join');

const btnCreateMode = document.getElementById('btn-create-mode');
const btnJoinMode = document.getElementById('btn-join-mode');
const btnLeaveSync = document.getElementById('btn-leave-sync');
const btnNumpadClear = document.getElementById('btn-numpad-clear');
const btnNumpadBack = document.getElementById('btn-numpad-back');

const displayRoomCode = document.getElementById('display-room-code');
const pairingQrImg = document.getElementById('pairing-qr-img');
const qrLoader = document.querySelector('.qr-loader');
const joinErrorMsg = document.getElementById('join-error-msg');

// Slide open drawers
function openDrawer(drawer) {
  Haptics.tap();
  drawerCreate.classList.remove('open');
  drawerJoin.classList.remove('open');
  drawer.classList.add('open');
}

// Shut drawers
function closeDrawers() {
  Haptics.tap();
  drawerCreate.classList.remove('open');
  drawerJoin.classList.remove('open');
  pinCodeInput = "";
  updatePinDisplay();
}

// Setup Virtual Pin Panel rendering
function updatePinDisplay() {
  for (let i = 1; i <= 4; i++) {
    const digitEl = document.getElementById(`digit-${i}`);
    if (pinCodeInput.length >= i) {
      digitEl.innerText = pinCodeInput[i - 1];
      digitEl.classList.add('active');
    } else {
      digitEl.innerText = "-";
      digitEl.classList.remove('active');
    }
  }
  joinErrorMsg.innerText = "";
}

// UI Panel Transition
function transitionToSyncScreen(roomId) {
  closeDrawers();
  lobbyScreen.classList.remove('active');
  document.getElementById('app-header').style.display = 'none'; // Hide header for canvas focus
  syncScreen.classList.add('active');
  
  document.getElementById('hud-room-code').innerText = roomId;
  resizeCanvas();
  Haptics.success();
}

// Bind Lobby Navigation Listeners
function initLobbyUI() {
  btnCreateMode.addEventListener('click', () => {
    openDrawer(drawerCreate);
    qrLoader.style.display = 'flex';
    pairingQrImg.classList.remove('loaded');
    pairingQrImg.src = "";
    
    // Request room creation from backend
    socket.emit('create-room', (response) => {
      if (response && response.success) {
        currentRoomId = response.roomId;
        displayRoomCode.innerText = response.roomId;
        pairingQrImg.src = response.qrCodeDataUrl;
        pairingQrImg.onload = () => {
          qrLoader.style.display = 'none';
          pairingQrImg.classList.add('loaded');
        };
      } else {
        alert("Failed to initialize sync room. Try again.");
      }
    });
  });

  btnJoinMode.addEventListener('click', () => {
    openDrawer(drawerJoin);
    pinCodeInput = "";
    updatePinDisplay();
  });

  // Attach drawer back close clicks
  document.querySelectorAll('.btn-close-drawer').forEach(btn => {
    btn.addEventListener('click', closeDrawers);
  });

  // Setup Touch Virtual Numpad
  document.querySelectorAll('.numpad button[data-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val');
      if (pinCodeInput.length < 4) {
        pinCodeInput += val;
        updatePinDisplay();
        Haptics.tap();

        // 4 digits completed - auto submit!
        if (pinCodeInput.length === 4) {
          socket.emit('join-room', pinCodeInput, (res) => {
            if (res && res.success) {
              currentRoomId = res.roomId;
              transitionToSyncScreen(res.roomId);
            } else {
              Haptics.vibrate(150);
              joinErrorMsg.innerText = res.error || "Room connection failed.";
              pinCodeInput = "";
              updatePinDisplay();
            }
          });
        }
      }
    });
  });

  btnNumpadClear.addEventListener('click', () => {
    pinCodeInput = "";
    updatePinDisplay();
    Haptics.tap();
  });

  btnNumpadBack.addEventListener('click', () => {
    if (pinCodeInput.length > 0) {
      pinCodeInput = pinCodeInput.slice(0, -1);
      updatePinDisplay();
      Haptics.tap();
    }
  });

  // Leave room triggers
  btnLeaveSync.addEventListener('click', () => {
    Haptics.tap();
    location.reload(); // Quick refresh is the cleanest room exit
  });
}

// Setup tactile heart emitter clicks on interactive HUD
function initEmitterUI() {
  document.querySelectorAll('.emitter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const type = btn.getAttribute('data-type');
      Haptics.tap();
      
      // Spawn local canvas feedback
      spawnHeartLocally(window.innerWidth / 2, window.innerHeight * 0.8, type);
      
      // Send to Socket Room partner
      socket.emit('send-heart', { type });

      // Run tap combo calculations
      registerTapForCombo();
    });
  });

  // Clicking anywhere directly on the screen canvas drops a classic heart or cute panda!
  canvas.addEventListener('click', (e) => {
    // Avoid double triggering if clicking active buttons/modals
    if (e.target.tagName === 'BUTTON' || e.target.closest('.hud-controls') || e.target.closest('.modal-card')) return;
    
    Haptics.tap();
    
    // Randomize between classic heart and panda on direct canvas click!
    const canvasClickTypes = ['classic', 'panda'];
    const type = canvasClickTypes[Math.floor(Math.random() * canvasClickTypes.length)];
    
    // Emit heart/panda at tap coordinates
    spawnHeartLocally(e.clientX, e.clientY, type);
    
    // Broadcast heart/panda
    socket.emit('send-heart', { type });

    // Register tap
    registerTapForCombo();
  });
}

// ==========================================================================
// SOCKET LISTENER SERVICES
// Real-time synchronization hooks
// ==========================================================================
function initSocketListeners() {
  // Successful Pairing established (either creator or joiner)
  socket.on('pairing-success', (data) => {
    isPartnerConnected = true;
    currentRoomId = data.roomId;
    
    document.getElementById('hud-status-text').innerText = "Sync Active";
    document.querySelector('.hud-status').style.color = 'var(--success-green)';
    document.querySelector('.hud-status').style.borderColor = 'rgba(52, 199, 89, 0.2)';
    document.querySelector('.status-dot').style.backgroundColor = 'var(--success-green)';

    // Transition panels if not already there (for creator who was waiting in drawer)
    if (!syncScreen.classList.contains('active')) {
      transitionToSyncScreen(data.roomId);
    }
  });

  // Real-time Heart Arrival
  socket.on('heart-received', (data) => {
    if (data.type === 'storm') {
      // Trigger full display explosive shower
      triggerHeartStorm(true);
    } else {
      // Float individual heart upward from top/center screen (simulating falling onto user's desk or phone)
      const rx = window.innerWidth / 2 + (Math.random() - 0.5) * 120;
      const ry = window.innerHeight * 0.15; // float from upper frame area
      
      const particle = new HeartParticle(rx, ry, data.type, data.textNote);
      // Alter speeds slightly so received particles float *down* first, or float gracefully outwards
      particle.vy = (Math.random() * 2 + 1); // Float downwards!
      particles.push(particle);
      
      // Sound feedback
      if (data.type === 'classic') SoundSynth.playClassic();
      else if (data.type === 'sparkle') SoundSynth.playSparkle();
      else if (data.type === 'fire') SoundSynth.playFire();
      else if (data.type === 'broken') SoundSynth.playBroken();
      else if (data.type === 'envelope') SoundSynth.playSparkle();
      else if (data.type === 'panda') SoundSynth.playPanda();
    }
  });

  // Partner Hold / Touch Sync Coordinates
  socket.on('heartbeat-hold-received', () => {
    partnerHoldActive = true;
    updateHeartbeatSyncState();
  });

  socket.on('heartbeat-release-received', () => {
    partnerHoldActive = false;
    updateHeartbeatSyncState();
  });

  // Partner Disconnect Cleanups
  socket.on('partner-disconnected', () => {
    isPartnerConnected = false;
    partnerHoldActive = false;
    updateHeartbeatSyncState();
    
    document.getElementById('hud-status-text').innerText = "Partner Offline";
    document.querySelector('.hud-status').style.color = 'var(--error-red)';
    document.querySelector('.hud-status').style.borderColor = 'rgba(255, 59, 48, 0.2)';
    document.querySelector('.status-dot').style.backgroundColor = 'var(--error-red)';
    
    Haptics.vibrate([100, 100, 100]);
  });
}

// ==========================================================================
// INITIALIZATION ON CONTENT LOADED
// ==========================================================================
window.addEventListener('DOMContentLoaded', () => {
  // Bind all interactive actions
  initLobbyUI();
  initEmitterUI();
  initHeartbeatPad();
  NoteSystem.init();
  initSocketListeners();
  
  // URL Auto-Pairing Integration (e.g. opens instantly if scans QR link)
  const urlParams = new URLSearchParams(window.location.search);
  const urlRoomCode = urlParams.get('room');
  if (urlRoomCode && urlRoomCode.length === 4) {
    // Attempt auto sync join
    socket.emit('join-room', urlRoomCode, (res) => {
      if (res && res.success) {
        currentRoomId = res.roomId;
        transitionToSyncScreen(res.roomId);
      } else {
        console.warn("Auto-sync join expired or code invalid.");
        // Redirect home
        window.history.replaceState({}, document.title, "/");
      }
    });
  }
});
