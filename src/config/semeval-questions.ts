export type RiskQuestionId = `Q${number}`;
export type ShieldQuestionId = `S${number}`;
export type QuestionId = RiskQuestionId | ShieldQuestionId;

export type QuestionBucket =
  | "EMOTION"
  | "IDENTITY_AUTHORITY"
  | "FALLACY_DEFLECTION"
  | "SEVERE_MANIPULATION"
  | "SHIELDS";

export interface SemEvalQuestion {
  id: QuestionId;
  num: number;
  bucket: QuestionBucket;
  name: string;
  pointsOrFlags: number;
  tier?: 1 | 2 | 3;
  description: string;
  isShield: boolean;
  isDeterministicOnly?: boolean;
}

export const SEMEVAL_QUESTIONS: Record<QuestionId, SemEvalQuestion> = {
  // ---------------------------------------------------------------------------
  // Tier 1 — Emotional Framing & Repetition (1 pt each, Bucket: EMOTION)
  // ---------------------------------------------------------------------------
  Q1: {
    id: "Q1",
    num: 1,
    bucket: "EMOTION",
    name: "Loaded Language",
    pointsOrFlags: 1,
    tier: 1,
    description: "Does the text use emotionally charged, vivid, graphic, or sensational words, scandalous accusations, metaphors, or scare quotes (e.g. vivid descriptions of misconduct, 'doomed', 'severe trouble', 'scandal', 'disaster', 'travesty', 'corrupt', 'childish', 'evil') to evoke indignation, disgust, or shock? (Excludes neutral news prose and direct quotes of public health data).",
    isShield: false,
  },
  Q2: {
    id: "Q2",
    num: 2,
    bucket: "EMOTION",
    name: "Exaggeration / Minimization",
    pointsOrFlags: 1,
    tier: 1,
    description: "Does it use extreme hyperbole, dramatic intensifiers, or sweeping magnification (e.g. 'extremely', 'unprecedented in history', 'completely doomed', 'massive disaster'), OR dismiss serious harm as totally trivial? (CRITICAL: Mild comparative descriptions like 'larger than usual' or factual estimates are NOT hyperbole).",
    isShield: false,
  },
  Q3: {
    id: "Q3",
    num: 3,
    bucket: "EMOTION",
    name: "Repetition / Slogans",
    pointsOrFlags: 1,
    tier: 1,
    description: "Does the text repeat words/phrases for rhetorical emphasis (e.g. 'very, very', 'again and again', 'fight, fight, fight'), OR use a memorable political catchphrase, campaign slogan, protest chant, or activist branding (e.g. 'Stop Islamization', 'Build the wall', 'America First', 'Take back control')?",
    isShield: false,
  },
  Q4: {
    id: "Q4",
    num: 4,
    bucket: "EMOTION",
    name: "Thought-Terminating Cliché",
    pointsOrFlags: 1,
    tier: 1,
    description: "Does it use dismissive sayings, idioms, or platitudes (e.g. 'it is what it is', 'end of story', 'wake up', 'common sense dictates') to shut down inquiry and debate?",
    isShield: false,
  },

  // ---------------------------------------------------------------------------
  // Tier 2 — Identity, Authority & Rhetorical Fallacies (2 pts each)
  // Bucket: IDENTITY_AUTHORITY
  // ---------------------------------------------------------------------------
  Q5: {
    id: "Q5",
    num: 5,
    bucket: "IDENTITY_AUTHORITY",
    name: "Name-Calling / Labeling",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it attach an insulting, derogatory, or villainizing label (e.g. 'crooked', 'traitors', 'thugs', 'puppets', 'extremists') to discredit an opponent, group, or idea?",
    isShield: false,
  },
  Q6: {
    id: "Q6",
    num: 6,
    bucket: "IDENTITY_AUTHORITY",
    name: "Doubt / Insinuation",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it question the competence, credibility, honesty, or capability of an official, leader, or institution, quote critics speculating, or use scare quotes to label a controversial policy (e.g. claiming they 'haven\\'t learned', 'failed to do their jobs', 'prompted critics to speculate', scare-quoted 'sanctuary' policy)? (Excludes standard legal hedges like 'allegedly' and balanced journalistic skepticism).",
    isShield: false,
  },
  Q7: {
    id: "Q7",
    num: 7,
    bucket: "IDENTITY_AUTHORITY",
    name: "Appeal to Authority",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it cite a leader, official, or self-serving office statement to validate an unverified claim, assert personal innocence, or lend credibility to a speculative prediction? (CRITICAL: Routine journalistic reporting of enacted government policies, bans, or official administrative actions, e.g. 'the Home Office banned X', is NOT an appeal to authority).",
    isShield: false,
  },
  Q8: {
    id: "Q8",
    num: 8,
    bucket: "IDENTITY_AUTHORITY",
    name: "Flag-Waving / Group Loyalty",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does the author explicitly appeal to patriotism, national pride, religion, or 'us vs them' civic loyalty ('we the people', 'our country', 'our sacred values', 'stage for our nation') to attack rivals or justify a policy? (CRITICAL: Routine news reporting about a protest location or mentioning group names like EDL is NOT flag-waving).",
    isShield: false,
  },
  Q9: {
    id: "Q9",
    num: 9,
    bucket: "IDENTITY_AUTHORITY",
    name: "Bandwagon Pressure",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it pressure the reader to conform by claiming 'everyone knows', 'the majority supports this', or urging people to join a popular wave?",
    isShield: false,
  },

  // ---------------------------------------------------------------------------
  // Tier 2 — Rhetorical Fallacies (2 pts each)
  // Bucket: FALLACY_DEFLECTION
  // ---------------------------------------------------------------------------
  Q10: {
    id: "Q10",
    num: 10,
    bucket: "FALLACY_DEFLECTION",
    name: "Causal Oversimplification",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it blame a complex societal or economic problem on a single scapegoat, group, or policy, or offer a simplistic magic-bullet fix?",
    isShield: false,
  },
  Q11: {
    id: "Q11",
    num: 11,
    bucket: "FALLACY_DEFLECTION",
    name: "Whataboutism",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it evade a direct criticism or accusation by pointing to unrelated misconduct or hypocrisy by an opponent instead of answering?",
    isShield: false,
  },
  Q12: {
    id: "Q12",
    num: 12,
    bucket: "FALLACY_DEFLECTION",
    name: "Strawman / Red Herring",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it distort an opponent position into an absurd caricature, OR introduce an emotional distraction to derail the core issue?",
    isShield: false,
  },
  Q13: {
    id: "Q13",
    num: 13,
    bucket: "FALLACY_DEFLECTION",
    name: "Slippery Slope / Cherry-Picking",
    pointsOrFlags: 2,
    tier: 2,
    description: "Does it claim without evidence that a moderate initial action will inevitably trigger a catastrophic chain reaction, OR treat an isolated anecdote as proof of a sweeping trend?",
    isShield: false,
  },

  // ---------------------------------------------------------------------------
  // Tier 3 — Severe Fear, Hatred & Conspiracy (3 pts each, Bucket: SEVERE_MANIPULATION)
  // ---------------------------------------------------------------------------
  Q14: {
    id: "Q14",
    num: 14,
    bucket: "SEVERE_MANIPULATION",
    name: "Appeal to Fear / Alarmism",
    pointsOrFlags: 3,
    tier: 3,
    description: "Does it warn of impending danger, crisis, or catastrophic harm to arouse anxiety or panic in the audience? (CRITICAL: Explaining biological resistance, flea vector control, or factual disease statistics without threat warnings is NOT alarmism).",
    isShield: false,
  },
  Q15: {
    id: "Q15",
    num: 15,
    bucket: "SEVERE_MANIPULATION",
    name: "Sweeping Stereotypes / Out-Group Hatred",
    pointsOrFlags: 3,
    tier: 3,
    description: "Does it portray an entire demographic, political, or social group as inherently malicious, inferior, or dangerous?",
    isShield: false,
  },
  Q16: {
    id: "Q16",
    num: 16,
    bucket: "SEVERE_MANIPULATION",
    name: "Dehumanization / Nazi Comparison",
    pointsOrFlags: 3,
    tier: 3,
    description: "Does the author attack an opponent or group by comparing them to vermin, pests, animals, or diseases, OR by labeling them Nazis or Hitler? (CRITICAL: Routine news reporting that mentions the names of civic organizations, e.g. 'anti-fascism campaigners', is NOT dehumanization).",
    isShield: false,
  },
  Q17: {
    id: "Q17",
    num: 17,
    bucket: "SEVERE_MANIPULATION",
    name: "Shadowy Cabal / Conspiracy",
    pointsOrFlags: 3,
    tier: 3,
    description: "Does it claim a sinister secret elite, cabal, or 'deep state' is covertly manipulating world events?",
    isShield: false,
  },
  Q18: {
    id: "Q18",
    num: 18,
    bucket: "SEVERE_MANIPULATION",
    name: "Black-and-White / Dictatorship",
    pointsOrFlags: 3,
    tier: 3,
    description: "Does it reduce a nuanced situation to an absolute binary choice ('you are either with us or against us', 'the only way')?",
    isShield: false,
  },

  // ---------------------------------------------------------------------------
  // Deterministic Network / Swarm Signal (Reserved strictly for Bun detector)
  // ---------------------------------------------------------------------------
  Q19: {
    id: "Q19",
    num: 19,
    bucket: "SEVERE_MANIPULATION",
    name: "Comment Swarm / Bot Template",
    pointsOrFlags: 3,
    tier: 3,
    description: "Deterministic pattern clustering, template phrasing, or bot telemetry score (evaluated exclusively by Bun).",
    isShield: false,
    isDeterministicOnly: true,
  },

  // ---------------------------------------------------------------------------
  // Strict False-Positive Shields (S1–S4 — Evaluated Separately, Bucket: SHIELDS)
  // ---------------------------------------------------------------------------
  S1: {
    id: "S1",
    num: 1,
    bucket: "SHIELDS",
    name: "Active Fact-Check / Debunking",
    pointsOrFlags: 2,
    description: "Is the primary purpose of the entire text to disprove, fact-check, or criticize a manipulative claim or conspiracy theory?",
    isShield: true,
  },
  S2: {
    id: "S2",
    num: 2,
    bucket: "SHIELDS",
    name: "Balanced Multi-Sided Reporting",
    pointsOrFlags: 2,
    description: "Does the author present competing viewpoints neutrally in balanced journalism without taking a partisan side or using manipulative spin?",
    isShield: true,
  },
  S3: {
    id: "S3",
    num: 3,
    bucket: "SHIELDS",
    name: "Satire / Absurd Parody",
    pointsOrFlags: 1,
    description: "Is the text clearly comedic satire, parody, or absurd humor not meant to be taken literally?",
    isShield: true,
  },
  S4: {
    id: "S4",
    num: 4,
    bucket: "SHIELDS",
    name: "Everyday Consumer / Sports Venting",
    pointsOrFlags: 1,
    description: "Is this purely a personal complaint about a product, service, customer support, or sports match with zero political or social agenda?",
    isShield: true,
  },
};

export const BUCKET_NAMES: Record<QuestionBucket, string> = {
  EMOTION: "Tier 1: Emotional Framing & Repetition",
  IDENTITY_AUTHORITY: "Tier 2: Identity, Authority & Loyalty",
  FALLACY_DEFLECTION: "Tier 2: Rhetorical Fallacies & Deflection",
  SEVERE_MANIPULATION: "Tier 3: Severe Fear, Hatred & Conspiracy",
  SHIELDS: "Strict False-Positive Shields",
};
