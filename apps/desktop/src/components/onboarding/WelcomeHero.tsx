import { motion } from 'framer-motion';

interface Props {
  userName: string | undefined;
  hasProjects: boolean;
  onCreateProject: () => void;
  onCreateBeat: () => void;
  onExploreFeed: () => void;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const rise = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function WelcomeHero({ userName, hasProjects, onCreateProject, onCreateBeat, onExploreFeed }: Props) {
  const firstName = userName?.split(' ')[0] || 'there';
  const greeting = hasProjects ? 'Welcome back,' : 'Welcome,';
  const subheading = hasProjects
    ? 'Pick up where you left off — or start something new.'
    : 'Produce with other artists in real time — inside your DAW.';

  return (
    <div className="relative flex-1 flex items-center justify-center px-8 overflow-hidden">
      {/* Ambient glow orbs */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 w-[520px] h-[520px] rounded-full blur-[120px]"
        style={{ background: 'radial-gradient(circle, rgba(0,255,200,0.18) 0%, rgba(0,255,200,0) 70%)' }}
        animate={{ x: [0, 40, 0], y: [0, -20, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -right-32 w-[540px] h-[540px] rounded-full blur-[140px]"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.22) 0%, rgba(124,58,237,0) 70%)' }}
        animate={{ x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="relative max-w-4xl w-full text-center z-10"
      >
        {/* Ghost mark */}
        <motion.div variants={rise} className="flex justify-center mt-16 mb-6">
          <motion.div
            className="relative"
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div
              aria-hidden
              className="absolute inset-0 rounded-full blur-2xl"
              style={{ background: 'radial-gradient(circle, rgba(0,255,200,0.35) 0%, rgba(124,58,237,0.15) 50%, transparent 75%)' }}
            />
            <svg width="96" height="106" viewBox="0 0 20 22" fill="none" className="relative">
              <defs>
                <linearGradient id="welcomeGhostMark" x1="0" y1="0" x2="20" y2="22" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#00FFC8" />
                  <stop offset="100%" stopColor="#7C3AED" />
                </linearGradient>
              </defs>
              <path
                d="M10 1C5.5 1 2 4.5 2 9v8l2-2 2 2 2-2 2 2 2-2 2 2 2-2 2 2V9c0-4.5-3.5-8-8-8z"
                fill="rgba(0,255,200,0.08)"
                stroke="url(#welcomeGhostMark)"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
              <ellipse cx="7.5" cy="9.5" rx="1.6" ry="1.8" fill="url(#welcomeGhostMark)" opacity="0.95" />
              <ellipse cx="12.5" cy="9.5" rx="1.6" ry="1.8" fill="url(#welcomeGhostMark)" opacity="0.95" />
              <ellipse cx="7.5" cy="9.2" rx="0.6" ry="0.7" fill="#0A0412" />
              <ellipse cx="12.5" cy="9.2" rx="0.6" ry="0.7" fill="#0A0412" />
            </svg>
          </motion.div>
        </motion.div>

        {/* Heading */}
        <motion.h1
          variants={rise}
          className="text-[26px] md:text-[30px] font-bold tracking-tight text-white leading-[1.15] mb-2"
          style={{ letterSpacing: '-0.02em' }}
        >
          {greeting}{' '}
          <span
            className="inline-block bg-clip-text text-transparent"
            style={{ backgroundImage: 'linear-gradient(120deg, #00FFC8 0%, #7C3AED 55%, #EC4899 100%)' }}
          >
            {firstName}
          </span>
        </motion.h1>

        {/* Subheading */}
        <motion.p
          variants={rise}
          className="text-[14px] md:text-[15px] text-white/55 mb-10 max-w-xl mx-auto"
        >
          {subheading}
        </motion.p>

        {/* Steps */}
        <motion.div variants={rise} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12 text-left">
          <StepCard index={0} number="01" title="Create a session" body="Start a new project or beat. Invite collaborators by email." />
          <StepCard index={1} number="02" title="Drop stems" body="Upload mix or individual stems. Everyone hears changes live." />
          <StepCard index={2} number="03" title="Drag into your DAW" body="Pull any stem straight into Ableton — no export step." />
        </motion.div>

        {/* CTAs */}
        <motion.div variants={rise} className="flex flex-wrap items-center justify-center gap-3">
          <PrimaryCTA onClick={onCreateProject} label={hasProjects ? 'New project' : 'Create your first project'} />
          <SecondaryCTA onClick={onCreateBeat} label="Start a beat" />
          <SecondaryCTA onClick={onExploreFeed} label="Explore the feed" />
        </motion.div>

        <motion.p variants={rise} className="text-[12px] text-white/30 mt-10">
          Tip — you can also drag an audio file anywhere in the app to start a new session.
        </motion.p>
      </motion.div>
    </div>
  );
}

function StepCard({ index, number, title, body }: { index: number; number: string; title: string; body: string }) {
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="group relative rounded-2xl p-6 overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.015) 100%)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 6px 20px rgba(0,0,0,0.25)',
      }}
    >
      {/* Animated gradient border on hover */}
      <motion.div
        aria-hidden
        className="absolute -inset-px rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
        style={{
          background: `linear-gradient(${120 + index * 40}deg, rgba(0,255,200,0.35), rgba(124,58,237,0.35), rgba(236,72,153,0.2))`,
          maskImage: 'linear-gradient(#000,#000), linear-gradient(#000,#000)',
          WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
          WebkitMaskComposite: 'xor',
          maskComposite: 'exclude',
          padding: 1,
        }}
      />

      {/* Large numeral — outlined, magazine style */}
      <div
        className="font-black leading-none mb-4 select-none"
        style={{
          fontSize: '56px',
          letterSpacing: '-0.04em',
          WebkitTextStroke: '1.5px rgba(255,255,255,0.22)',
          color: 'transparent',
          fontFeatureSettings: '"tnum"',
        }}
      >
        {number}
      </div>

      <div className="text-[18px] font-semibold text-white mb-2 tracking-tight">{title}</div>
      <div className="text-[15px] text-white/65 leading-[1.55]">{body}</div>
    </motion.div>
  );
}

function PrimaryCTA({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.97 }}
      className="relative px-7 h-12 rounded-full text-white text-[15px] font-semibold overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)',
        boxShadow:
          '0 4px 14px rgba(124,58,237,0.45), 0 0 0 1px rgba(255,255,255,0.08) inset, 0 1px 0 rgba(255,255,255,0.2) inset',
      }}
    >
      {/* Sheen sweep on hover */}
      <motion.span
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        initial={{ x: '-120%' }}
        whileHover={{ x: '120%' }}
        transition={{ duration: 0.7 }}
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%)',
        }}
      />
      <span className="relative">{label}</span>
    </motion.button>
  );
}

function SecondaryCTA({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.03, borderColor: 'rgba(255,255,255,0.28)' }}
      whileTap={{ scale: 0.97 }}
      className="px-6 h-12 rounded-full text-white text-[14px] font-semibold transition-colors"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {label}
    </motion.button>
  );
}
