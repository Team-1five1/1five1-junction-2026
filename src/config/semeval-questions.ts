export interface SemEvalQuestion {
  id: `Q${number}`;
  num: number;
  bucket: number;
  name: string;
  pointsOrFlags: number;
  tier?: 1 | 2 | 3;
  description: string;
  isShield: boolean;
}

export const SEMEVAL_QUESTIONS: Record<`Q${number}`, SemEvalQuestion> = {
  // Bucket 1: Manipulative Wording & Emotional Framing
  Q1: { id: "Q1", num: 1, bucket: 1, name: "Loaded Words", pointsOrFlags: 1, tier: 1, description: "Does the text use intense emotional words where neutral words would fit?", isShield: false },
  Q2: { id: "Q2", num: 2, bucket: 1, name: "Exaggeration", pointsOrFlags: 1, tier: 1, description: "Does it blow the scale, severity, or impact of an event wildly out of proportion?", isShield: false },
  Q3: { id: "Q3", num: 3, bucket: 1, name: "Minimization", pointsOrFlags: 1, tier: 1, description: "Does it downplay or brush off documented harm, casualties, or wrongdoing as trivial?", isShield: false },
  Q4: { id: "Q4", num: 4, bucket: 1, name: "Alarmist Formatting", pointsOrFlags: 1, tier: 1, description: "Does it use ALL CAPS, excessive exclamation marks, or siren emojis to force an emotional reaction?", isShield: false },
  Q5: { id: "Q5", num: 5, bucket: 1, name: "Intentional Vagueness", pointsOrFlags: 1, tier: 1, description: "Does it use confusing jargon or murky phrasing to hide a weak or unproven claim?", isShield: false },
  Q6: { id: "Q6", num: 6, bucket: 1, name: "Bait-and-Switch Framing", pointsOrFlags: 1, tier: 1, description: "Does the opening line promise a shocking revelation that the rest of the text fails to support?", isShield: false },
  Q7: { id: "Q7", num: 7, bucket: 1, name: "Unbacked Absolutes", pointsOrFlags: 1, tier: 1, description: "Does it rely on absolute terms like 'always', 'never', or '100% undeniable' without data?", isShield: false },
  Q8: { id: "Q8", num: 8, bucket: 1, name: "Dehumanizing Metaphors", pointsOrFlags: 3, tier: 3, description: "Does it compare people or groups to pests, diseases, floods, or parasites?", isShield: false },

  // Bucket 2: Stereotyping, Labeling & Reputation Attacks
  Q9: { id: "Q9", num: 9, bucket: 2, name: "Name-Calling", pointsOrFlags: 2, tier: 2, description: "Does it attach an insulting label or nickname to a person or group instead of addressing actions?", isShield: false },
  Q10: { id: "Q10", num: 10, bucket: 2, name: "Sweeping Stereotypes", pointsOrFlags: 3, tier: 3, description: "Does it assign a single negative trait, motive, or behavior to an entire demographic or group?", isShield: false },
  Q11: { id: "Q11", num: 11, bucket: 2, name: "Guilt by Association", pointsOrFlags: 2, tier: 2, description: "Does it discredit an idea or person solely by linking them to a hated or extremist group?", isShield: false },
  Q12: { id: "Q12", num: 12, bucket: 2, name: "Extreme Historical Comparisons", pointsOrFlags: 2, tier: 2, description: "Does it compare an opponent or policy to Nazis, Hitler, or totalitarian regimes to shut down debate?", isShield: false },
  Q13: { id: "Q13", num: 13, bucket: 2, name: "Assumed Malice", pointsOrFlags: 2, tier: 2, description: "Does it claim an opponent acts out of pure evil, greed, or treason rather than a difference of opinion?", isShield: false },
  Q14: { id: "Q14", num: 14, bucket: 2, name: "Manufactured Doubt", pointsOrFlags: 2, tier: 2, description: "Does it undermine trust in a person or institution solely through unverified insinuations?", isShield: false },
  Q15: { id: "Q15", num: 15, bucket: 2, name: "Hypocrisy Deflection", pointsOrFlags: 2, tier: 2, description: "Does it dismiss an argument solely by accusing the speaker of past hypocrisy?", isShield: false },
  Q16: { id: "Q16", num: 16, bucket: 2, name: "Out-Group Villainization", pointsOrFlags: 3, tier: 3, description: "Does it portray an opposing group as inherently corrupt, dangerous, or beyond redemption?", isShield: false },
  Q17: { id: "Q17", num: 17, bucket: 2, name: "Shadowy Cabal Framing", pointsOrFlags: 3, tier: 3, description: "Does it blame a secret, unnamed elite ('puppet masters', 'they') for complex events?", isShield: false },

  // Bucket 3: Fear, Prejudice & Group Identity Appeals
  Q18: { id: "Q18", num: 18, bucket: 3, name: "Existential Fear Appeal", pointsOrFlags: 3, tier: 3, description: "Does it claim that failing to agree will destroy the reader's safety, family, or way of life?", isShield: false },
  Q19: { id: "Q19", num: 19, bucket: 3, name: "Prejudice Activation", pointsOrFlags: 3, tier: 3, description: "Does it tap into preexisting racial, religious, class, or cultural resentments to provoke anger?", isShield: false },
  Q20: { id: "Q20", num: 20, bucket: 3, name: "Flag-Waving / Loyalty Test", pointsOrFlags: 2, tier: 2, description: "Does it claim that supporting its viewpoint is the only way to be a 'true patriot' or loyal member?", isShield: false },
  Q21: { id: "Q21", num: 21, bucket: 3, name: "In-Group Flattery", pointsOrFlags: 2, tier: 2, description: "Does it praise the reader's group as uniquely virtuous, hardworking, or enlightened compared to outsiders?", isShield: false },
  Q22: { id: "Q22", num: 22, bucket: 3, name: "Bandwagon Pressure", pointsOrFlags: 2, tier: 2, description: "Does it argue that 'everyone is waking up' or 'millions already agree' to pressure conformity?", isShield: false },
  Q23: { id: "Q23", num: 23, bucket: 3, name: "False Authority", pointsOrFlags: 2, tier: 2, description: "Does it cite an unqualified celebrity, anonymous 'insider', or vague 'experts' to validate a claim?", isShield: false },
  Q24: { id: "Q24", num: 24, bucket: 3, name: "Weaponized Values", pointsOrFlags: 2, tier: 2, description: "Does it invoke religion, children's safety, or moral purity to make questioning the argument seem immoral?", isShield: false },
  Q25: { id: "Q25", num: 25, bucket: 3, name: "Grievance Amplification", pointsOrFlags: 3, tier: 3, description: "Does it tell the audience they are being systematically humiliated, replaced, or cheated by an out-group?", isShield: false },

  // Bucket 4: Oversimplification & Logical Traps
  Q26: { id: "Q26", num: 26, bucket: 4, name: "Black-and-White Fallacy", pointsOrFlags: 3, tier: 3, description: "Does it present only two extreme choices ('with us or against us') while ignoring middle ground?", isShield: false },
  Q27: { id: "Q27", num: 27, bucket: 4, name: "Single-Cause Scapegoating", pointsOrFlags: 3, tier: 3, description: "Does it blame a complex economic, social, or political problem entirely on one person or group?", isShield: false },
  Q28: { id: "Q28", num: 28, bucket: 4, name: "Magic-Bullet / Total-Ruin Claim", pointsOrFlags: 2, tier: 2, description: "Does it claim a single policy or action will automatically fix everything or cause total collapse?", isShield: false },
  Q29: { id: "Q29", num: 29, bucket: 4, name: "Slippery Slope", pointsOrFlags: 2, tier: 2, description: "Does it assert without evidence that a minor step will inevitably trigger a chain reaction to disaster?", isShield: false },
  Q30: { id: "Q30", num: 30, bucket: 4, name: "Cherry-Picked Anecdote", pointsOrFlags: 2, tier: 2, description: "Does it use one isolated, extreme incident as proof of a massive nationwide trend?", isShield: false },
  Q31: { id: "Q31", num: 31, bucket: 4, name: "Coincidence as Conspiracy", pointsOrFlags: 2, tier: 2, description: "Does it treat two unrelated events happening at the same time as proof of a coordinated plot?", isShield: false },
  Q32: { id: "Q32", num: 32, bucket: 4, name: "No-Choice Framing", pointsOrFlags: 2, tier: 2, description: "Does it state an aggressive or controversial action as the 'only possible option' left?", isShield: false },

  // Bucket 5: Distraction, Deflection & Disinformation Tactics
  Q33: { id: "Q33", num: 33, bucket: 5, name: "Whataboutism", pointsOrFlags: 2, tier: 2, description: "Does it deflect a specific criticism by pointing to a completely different wrongdoing by someone else?", isShield: false },
  Q34: { id: "Q34", num: 34, bucket: 5, name: "Strawman Distortion", pointsOrFlags: 2, tier: 2, description: "Does it exaggerate or twist an opponent's actual position into something absurd to attack it?", isShield: false },
  Q35: { id: "Q35", num: 35, bucket: 5, name: "Red Herring", pointsOrFlags: 2, tier: 2, description: "Does it introduce an emotionally charged, irrelevant side topic to distract from the main issue?", isShield: false },
  Q36: { id: "Q36", num: 36, bucket: 5, name: "Unverifiable Sourcing", pointsOrFlags: 2, tier: 2, description: "Does it rely on phrases like 'sources say' or 'what they don't want you to know' with zero checkable citations?", isShield: false },
  Q37: { id: "Q37", num: 37, bucket: 5, name: "Disguised Partisanship", pointsOrFlags: 3, tier: 3, description: "Does it mimic the style of an objective breaking-news alert while presenting only one-sided propaganda?", isShield: false },
  Q38: { id: "Q38", num: 38, bucket: 5, name: "Contradictory Flooding", pointsOrFlags: 3, tier: 3, description: "Does it throw out multiple conflicting explanations at once just to muddy the waters?", isShield: false },

  // Bucket 6: Bot Amplification, Urgency & Thought-Killers
  Q39: { id: "Q39", num: 39, bucket: 6, name: "Thought-Terminating Cliché", pointsOrFlags: 1, tier: 1, description: "Does it use a canned phrase ('It is what it is', 'Follow the money') to stop critical thinking?", isShield: false },
  Q40: { id: "Q40", num: 40, bucket: 6, name: "Slogan Repetition", pointsOrFlags: 1, tier: 1, description: "Does it repeat the exact same catchphrase or talking point multiple times within a short text?", isShield: false },
  Q41: { id: "Q41", num: 41, bucket: 6, name: "Artificial Urgency", pointsOrFlags: 3, tier: 3, description: "Does it pressure the reader to act or share immediately before 'it gets censored/deleted'?", isShield: false },
  Q42: { id: "Q42", num: 42, bucket: 6, name: "Engagement Bait", pointsOrFlags: 1, tier: 1, description: "Does it end with a manipulative hook designed purely to farm algorithm replies ('Bet you won't repost this')?", isShield: false },
  Q43: { id: "Q43", num: 43, bucket: 6, name: "Keyword/Hashtag Stuffing", pointsOrFlags: 1, tier: 1, description: "Does it pack unrelated trending hashtags, @mentions, or keywords to hijack search feeds?", isShield: false },
  Q44: { id: "Q44", num: 44, bucket: 6, name: "Template Phrasing", pointsOrFlags: 3, tier: 3, description: "Does the sentence structure feel like a rigid, copy-pasted script used in coordinated comment swarms?", isShield: false },

  // Bucket 7: False-Positive Shields / Benign Context Checks
  Q45: { id: "Q45", num: 45, bucket: 7, name: "Satire or Parody", pointsOrFlags: 1, description: "Does the text show clear signs of comedy, irony, absurd exaggeration, or meme humor?", isShield: true },
  Q46: { id: "Q46", num: 46, bucket: 7, name: "Neutral Reporting/Quoting", pointsOrFlags: 2, description: "Is the author only quoting or describing extreme language in order to report on it neutrally?", isShield: true },
  Q47: { id: "Q47", num: 47, bucket: 7, name: "Counterspeech/Debunking", pointsOrFlags: 2, description: "Is the text mentioning a stereotype, fallacy, or conspiracy specifically to criticize or disprove it?", isShield: true },
  Q48: { id: "Q48", num: 48, bucket: 7, name: "Balanced Perspective", pointsOrFlags: 1, description: "Does the author acknowledge counterarguments, nuance, or limitations in their own position?", isShield: true },
  Q49: { id: "Q49", num: 49, bucket: 7, name: "Verifiable Receipts", pointsOrFlags: 2, description: "Does the text back up its strong claims with specific, checkable data, dates, or named primary sources?", isShield: true },
  Q50: { id: "Q50", num: 50, bucket: 7, name: "Everyday Personal Venting", pointsOrFlags: 1, description: "Is the emotional language just a normal person complaining about a product, service, sports game, or bad day?", isShield: true },
};

export const BUCKET_NAMES: Record<number, string> = {
  1: "Manipulative Wording & Emotional Framing",
  2: "Stereotyping, Labeling & Reputation Attacks",
  3: "Fear, Prejudice & Group Identity Appeals",
  4: "Oversimplification & Logical Traps",
  5: "Distraction, Deflection & Disinformation Tactics",
  6: "Bot Amplification, Urgency & Thought-Killers",
  7: "False-Positive Shields / Benign Context Checks",
};
