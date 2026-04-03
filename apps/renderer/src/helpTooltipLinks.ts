import type { HelpTooltipLink } from './HelpTooltip';

/**
 * Curated YouTube tutorial links for mastering-related help tooltips.
 * Each array should contain only focused, section-relevant videos.
 *
 * IMPORTANT: Every video ID must be verified to return HTTP 200 from
 * https://img.youtube.com/vi/<ID>/mqdefault.jpg — otherwise the
 * thumbnail will show a grey placeholder instead of an actual image.
 */


const TUTORIALS_PER_DIALOG = 9;

const MASTERING_TUTORIAL_FALLBACKS: readonly HelpTooltipLink[] = [
  {
    label: 'Mastering Start To Finish: Loud and Clear Masters - In The Mix',
    url: 'https://www.youtube.com/watch?v=ZHXD-BlKyL8',
  },
  {
    label: "You don't need to master to -14 LUFS - iZotope",
    url: 'https://www.youtube.com/watch?v=SfVchGaKqmo',
  },
  {
    label: 'How To Mix With a Spectrum Analyser - SPAN Tutorial - In The Mix',
    url: 'https://www.youtube.com/watch?v=Enj39FWxHJ4',
  },
  {
    label: 'How Loud Should You Master Your Music? - In The Mix',
    url: 'https://www.youtube.com/watch?v=GBqeSbisROU',
  },
  {
    label: 'How to Use Tonal Balance Control for Mixing & Mastering - Splice',
    url: 'https://www.youtube.com/watch?v=Y1kTO5KW17E',
  },
  {
    label: 'Understanding EVERY Volume Measurement (LUFS, RMS, VU, Peak) - The Band Guide',
    url: 'https://www.youtube.com/watch?v=Sg6NDXR9qIo',
  },
  {
    label: 'What Is DC Offset? - Sweetwater',
    url: 'https://www.youtube.com/watch?v=40rKM0rbqeA',
  },
  {
    label: 'Stereo Imaging in Mastering: Width and Mid/Side - iZotope Are You Listening?',
    url: 'https://www.youtube.com/watch?v=0tqlHNuacik',
  },
  {
    label: 'Hard Clipping vs Soft Clipping & Oversampling Explained - Radium Records',
    url: 'https://www.youtube.com/watch?v=yDQ7C92REGo',
  },
  {
    label: 'Mid Side EQ Simplified - In The Mix',
    url: 'https://www.youtube.com/watch?v=kEiILPm1VSc',
  },
  {
    label: 'All Your Audio Meters Explained (LU, LUFS and more) - Next Level Sound',
    url: 'https://www.youtube.com/watch?v=DZIrlcIV4PM',
  },
  {
    label: 'Why Is My Album Quiet On Spotify? - Dan Worrall',
    url: 'https://www.youtube.com/watch?v=CdAVp2YtcLs',
  },
];

function stripAiRankPrefix(label: string): string {
  return label.replace(/^(AI-ranked\s*)?#?\d+[:.)-]?\s*/i, '').trim();
}

function withAiRankedTutorials(sourceLinks: readonly HelpTooltipLink[]): HelpTooltipLink[] {
  const merged = [...sourceLinks, ...MASTERING_TUTORIAL_FALLBACKS];
  const ranked: HelpTooltipLink[] = [];
  const seenUrls = new Set<string>();

  for (const link of merged) {
    const url = link.url?.trim();
    if (!url || seenUrls.has(url)) {
      continue;
    }

    seenUrls.add(url);
    ranked.push({
      label: stripAiRankPrefix(link.label),
      url,
    });

    if (ranked.length >= TUTORIALS_PER_DIALOG) {
      break;
    }
  }

  return ranked.map((link, index) => ({
    label: `#${index + 1}: ${link.label}`,
    url: link.url,
  }));
}

export const LUFS_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: "You don't need to master to -14 LUFS - iZotope",
    url: 'https://www.youtube.com/watch?v=SfVchGaKqmo',
  },
  {
    label: 'How Loud Should You Master Your Music? - In The Mix',
    url: 'https://www.youtube.com/watch?v=GBqeSbisROU',
  },
  {
    label: 'Loudness Targets for Mastering (not what streaming services tell you) - SonicScoop',
    url: 'https://www.youtube.com/watch?v=wtoB6oj_xRw',
  },
  {
    label: 'LUFS Explained - SIMPLE! (Mastering for Spotify) - EDM Tips',
    url: 'https://www.youtube.com/watch?v=vidK3mE5Mn0',
  },
  {
    label: 'Understanding EVERY Volume Measurement (LUFS, RMS, VU, Peak) - The Band Guide',
    url: 'https://www.youtube.com/watch?v=Sg6NDXR9qIo',
  },
]);

export const TRUE_PEAK_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How Loud Should You Master Your Music? - In The Mix',
    url: 'https://www.youtube.com/watch?v=GBqeSbisROU',
  },
  {
    label: 'What is True Peak Limiting & Why it Matters - Plugin Boutique',
    url: 'https://www.youtube.com/watch?v=jdsQdcJeFsw',
  },
  {
    label: 'True Peak Limiting in 2024 - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=2tvkDSO4BJo',
  },
  {
    label: 'Inter-sample Peaks in Mastering: Why Nobody Cares? - MixbusTv',
    url: 'https://www.youtube.com/watch?v=SskN8cRNzkI',
  },
  {
    label: 'What is True Peak vs Absolute Peak and Why it Matters - The Audio Professor',
    url: 'https://www.youtube.com/watch?v=xHZVxdusIrI',
  },
]);

export const LRA_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'What is Dynamic Range and Why is it Important? - That Audio Guy',
    url: 'https://www.youtube.com/watch?v=gNqe7r7xflI',
  },
  {
    label: 'What Is Loudness Range (LRA)? - TheModernCreative',
    url: 'https://www.youtube.com/watch?v=6m02XaDBC6E',
  },
  {
    label: 'Dynamic Range LRA in Mixing Explained - Sound Freak Studios',
    url: 'https://www.youtube.com/watch?v=CBTCdDVgpLQ',
  },
  {
    label: 'What is Dynamic Range in Music? - FireWalk',
    url: 'https://www.youtube.com/watch?v=B4utC5FYAFc',
  },
  {
    label: 'Audio Loudness Range (LRA) Explained - Dana Tucker',
    url: 'https://www.youtube.com/watch?v=4UC2rlmTXpE',
  },
]);

export const STEREO_CORRELATION_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How to Read and Understand the Phase Meter - Fender Studio / PreSonus',
    url: 'https://www.youtube.com/watch?v=_Ib6Yf6F8Cg',
  },
  {
    label: 'How to Understand a Phase Correlation Meter - AM Music',
    url: 'https://www.youtube.com/watch?v=180X8yzIskE',
  },
  {
    label: 'Understanding Phase Can SAVE Your Mix! - Joey Sturgis Tones',
    url: 'https://www.youtube.com/watch?v=WzQuOGuSeEE',
  },
  {
    label: 'How to Use a Goniometer / Phase Scope When Mastering - Mastering Explained',
    url: 'https://www.youtube.com/watch?v=e2L_eCp6184',
  },
  {
    label: 'Correlation Meter Explained - Thomas van Opstal',
    url: 'https://www.youtube.com/watch?v=zvk3vtlTKbk',
  },
]);

export const SPECTRUM_ANALYZER_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How To Mix With a Spectrum Analyser - SPAN Tutorial - In The Mix',
    url: 'https://www.youtube.com/watch?v=Enj39FWxHJ4',
  },
  {
    label: 'Mixing With Your Eyes: Voxengo SPAN Mixing Settings - Dan Worrall',
    url: 'https://www.youtube.com/watch?v=iZrWMv02tlA',
  },
  {
    label: 'SPAN Spectrum Analyzer Tutorial - Audio Mountain',
    url: 'https://www.youtube.com/watch?v=pWPMkmyLpJw',
  },
  {
    label: 'How to Use Voxengo SPAN: EVERYTHING You Need to Know - Futureproof',
    url: 'https://www.youtube.com/watch?v=-MHpFsAHE-I',
  },
  {
    label: "Don't Make This Mistake When Using a Spectrum Analyzer - Sam Smyers",
    url: 'https://www.youtube.com/watch?v=SvGdIX3FDBs',
  },
]);

export const LEVEL_METER_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'All Your Audio Meters Explained (LU, LUFS and more) - Next Level Sound',
    url: 'https://www.youtube.com/watch?v=DZIrlcIV4PM',
  },
  {
    label: 'Levels and Loudness Metering (RMS, LUFS and True Peak) - Sean Divine',
    url: 'https://www.youtube.com/watch?v=myTcnK1lRUA',
  },
  {
    label: 'Digital Metering 101 - dBFS, RMS, LUFS and more - Audio Production Tips',
    url: 'https://www.youtube.com/watch?v=jeBjyHm5LKc',
  },
  {
    label: 'Understanding LUFS vs RMS in Your Mix - Mixed by Inesen',
    url: 'https://www.youtube.com/watch?v=SZ5Mvy14Utw',
  },
  {
    label: 'Understanding EVERY Volume Measurement (LUFS, RMS, VU, Peak) - The Band Guide',
    url: 'https://www.youtube.com/watch?v=Sg6NDXR9qIo',
  },
]);

export const WAVEFORM_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Hard Clipping vs Soft Clipping & Oversampling Explained - Radium Records',
    url: 'https://www.youtube.com/watch?v=yDQ7C92REGo',
  },
  {
    label: 'When and How to Use Clipping in Mastering - Matty Harris',
    url: 'https://www.youtube.com/watch?v=HMYETfqhgSo',
  },
  {
    label: 'Compression vs Limiting vs Clipping - Mastering.com',
    url: 'https://www.youtube.com/watch?v=5pKbIRxhxIw',
  },
  {
    label: 'Clipping vs Limiting Explained - Cableguys',
    url: 'https://www.youtube.com/watch?v=aFe9Gv5YvuI',
  },
  {
    label: 'This Changed How I Use Clippers in Mastering Forever - Panorama',
    url: 'https://www.youtube.com/watch?v=1b0TfgnpWzo',
  },
]);

export const VECTORSCOPE_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How To Use A Stereo Vectorscope Meter - Cableguys',
    url: 'https://www.youtube.com/watch?v=z7_yMcomycw',
  },
  {
    label: 'Stereo Imaging in Mastering: Width and Mid/Side - iZotope Are You Listening?',
    url: 'https://www.youtube.com/watch?v=0tqlHNuacik',
  },
  {
    label: 'The MODERN Way To Mix Stereo Width - Cableguys',
    url: 'https://www.youtube.com/watch?v=x8IoZl5h7uY',
  },
  {
    label: '5 Stereo Width Tips For Wider Mixes - Cableguys',
    url: 'https://www.youtube.com/watch?v=Uv8Q-m7RDG8',
  },
  {
    label: 'Stereo Width + Mono Compatible: Is it Impossible? - Warp Academy',
    url: 'https://www.youtube.com/watch?v=cdc4nsp1T5A',
  },
]);

export const PLATFORM_NORMALIZATION_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Why Is My Album Quiet On Spotify? - Dan Worrall',
    url: 'https://www.youtube.com/watch?v=CdAVp2YtcLs',
  },
  {
    label: 'How Loudness Normalisation Works in Streaming Services - Joseph Cameron Music',
    url: 'https://www.youtube.com/watch?v=WNpDcuk3Oqc',
  },
  {
    label: "DON'T DO -14 LUFS - Streaky",
    url: 'https://www.youtube.com/watch?v=aO0dR0wOIkk',
  },
  {
    label: 'Debunking -14 LUFS Spotify Normalization - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=vLYK0VQq4B4',
  },
  {
    label: 'Mastering for YouTube Loudness Normalization - Sean Divine',
    url: 'https://www.youtube.com/watch?v=1QY9NLpv8mU',
  },
]);

export const REFERENCE_TRACK_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Why You Need To Use Reference Tracks When Mixing - In The Mix',
    url: 'https://www.youtube.com/watch?v=ltscrItAWxg',
  },
  {
    label: "Don't Use Reference Tracks Like This - Produce Like A Pro",
    url: 'https://www.youtube.com/watch?v=fujD5Osw5DY',
  },
  {
    label: 'How to Use Reference Mixes (The RIGHT WAY) - SonicScoop',
    url: 'https://www.youtube.com/watch?v=O3Vf6Bmbi4I',
  },
  {
    label: 'How To Use Reference Tracks When Mixing Music - Mastering The Mix',
    url: 'https://www.youtube.com/watch?v=70vDmFoCWD8',
  },
  {
    label: 'Mastering with a Reference Track using Audiolens - iZotope',
    url: 'https://www.youtube.com/watch?v=IpjL-hCPBEE',
  },
]);

export const MID_SIDE_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Mid Side EQ Simplified - In The Mix',
    url: 'https://www.youtube.com/watch?v=kEiILPm1VSc',
  },
  {
    label: 'How to Use Mid/Side Processing - iZotope',
    url: 'https://www.youtube.com/watch?v=xKYD5hG1x_Q',
  },
  {
    label: 'Mid Side Demystified - FabFilter',
    url: 'https://www.youtube.com/watch?v=NilfCElGJ2c',
  },
  {
    label: 'What is Mid Side Processing? (and how to use it during mastering) - Sage Audio',
    url: 'https://www.youtube.com/watch?v=z2zGgchC3bM',
  },
  {
    label: 'What is Mid/Side Processing? - Matty Harris',
    url: 'https://www.youtube.com/watch?v=peUoYLk2BoQ',
  },
]);

export const K_METERING_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'K-System Metering Introduction - MeterPlugs',
    url: 'https://www.youtube.com/watch?v=GnREPzUfUgU',
  },
  {
    label: 'K-System for Dummies - Fender Studio',
    url: 'https://www.youtube.com/watch?v=YJ35HKss1as',
  },
  {
    label: 'Bob Katz - Music Mastering and Loudness Part 1 - TC Electronic',
    url: 'https://www.youtube.com/watch?v=8EgamkLkXW8',
  },
  {
    label: 'K Metering Explained - Distinct Mastering',
    url: 'https://www.youtube.com/watch?v=FiAIK2_64do',
  },
  {
    label: 'The Ultimate K System Tutorial - Hexspa',
    url: 'https://www.youtube.com/watch?v=_LnicZNgoYI',
  },
]);

export const CREST_FACTOR_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Clipping to Manage Crest Factor - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=DvszBRX3rtU',
  },
  {
    label: 'Crest Factor and Clipping - Rapid-Fire Q&A - MixbusTv',
    url: 'https://www.youtube.com/watch?v=wtivirKwoG4',
  },
  {
    label: 'What Is Crest Factor? - Electronic Mix Masters',
    url: 'https://www.youtube.com/watch?v=GWNJo3h6CIQ',
  },
  {
    label: 'Dynamics, RMS and Peak Levels - iZotope Pro Audio Essentials',
    url: 'https://www.youtube.com/watch?v=_z7VvE_2Sac',
  },
  {
    label: 'Mastering Crest Factor: Softening Peaks in Audio - E-Clip Music',
    url: 'https://www.youtube.com/watch?v=SLAK1dyfHkQ',
  },
]);

export const DC_OFFSET_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'What Is DC Offset? - Sweetwater',
    url: 'https://www.youtube.com/watch?v=40rKM0rbqeA',
  },
  {
    label: 'DC Offset: How Much Is Too Much? - Boogie Snail Mastering',
    url: 'https://www.youtube.com/watch?v=hlRiQ7LB4QQ',
  },
  {
    label: 'Sound Explained: DC Offset - Beat School',
    url: 'https://www.youtube.com/watch?v=ocQYYK9LQ1s',
  },
  {
    label: 'How To Fix DC Offset Using Any EQ - David Dumais Audio',
    url: 'https://www.youtube.com/watch?v=Y2rQxw4IaSo',
  },
  {
    label: 'DC Offset Explained - Beat School',
    url: 'https://www.youtube.com/watch?v=iKLEjrtHOTs',
  },
]);

export const DYNAMIC_RANGE_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How Music Got Loud (The Loudness Wars Explained) - Waves Audio',
    url: 'https://www.youtube.com/watch?v=n1k1fgtwylQ',
  },
  {
    label: 'Compression, Dynamic Range, and the Loudness Wars - Berklee Online',
    url: 'https://www.youtube.com/watch?v=Y4qk_O7q0Lk',
  },
  {
    label: 'What is Dynamic Range and Why is it Important? - That Audio Guy',
    url: 'https://www.youtube.com/watch?v=gNqe7r7xflI',
  },
  {
    label: 'The Loudness War - Matt Mayfield Music',
    url: 'https://www.youtube.com/watch?v=3Gmex_4hreQ',
  },
  {
    label: 'How Dynamic Range & the Loudness War is Deceiving You - Chill Duder',
    url: 'https://www.youtube.com/watch?v=isSCFVXyrao',
  },
]);

export const TONAL_BALANCE_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How to Use Tonal Balance Control for Mixing & Mastering - Splice',
    url: 'https://www.youtube.com/watch?v=Y1kTO5KW17E',
  },
  {
    label: 'Tonal Balance Control 3: The Top 10 Reference Tracks of All Time - iZotope',
    url: 'https://www.youtube.com/watch?v=q3TC_-JwXSM',
  },
  {
    label: 'How and When to Use Improved Tonal Balance Control - iZotope Ozone',
    url: 'https://www.youtube.com/watch?v=PhAPM2XQWGI',
  },
  {
    label: 'Get a Pro Sounding Mix with Tonal Balance Control - iZotope',
    url: 'https://www.youtube.com/watch?v=QruneruRYsc',
  },
  {
    label: 'How to Achieve Tonal Balance in Your Mixes - Jay TheMg',
    url: 'https://www.youtube.com/watch?v=bshSKtP8SAc',
  },
]);

export const LOUDNESS_HISTORY_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'All Your Audio Meters Explained (LU, LUFS and more) - Next Level Sound',
    url: 'https://www.youtube.com/watch?v=DZIrlcIV4PM',
  },
  {
    label: 'How Loud Should You Master Your Music? - In The Mix',
    url: 'https://www.youtube.com/watch?v=GBqeSbisROU',
  },
  {
    label: 'Digital Metering 101 - dBFS, RMS, LUFS and more - Audio Production Tips',
    url: 'https://www.youtube.com/watch?v=jeBjyHm5LKc',
  },
  {
    label: 'LUFS Explained - Music Production Terminology - Ben Kestok',
    url: 'https://www.youtube.com/watch?v=jkH2huVRmjU',
  },
  {
    label: 'How to Make Your Song Loud in the Age of Normalization - Sage Audio',
    url: 'https://www.youtube.com/watch?v=P8dzgU5Q4NU',
  },
]);

export const CLIP_COUNT_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Hard Clipping vs Soft Clipping & Oversampling Explained - Radium Records',
    url: 'https://www.youtube.com/watch?v=yDQ7C92REGo',
  },
  {
    label: 'The Science of Clipping: The ULTIMATE Tool for Loudness - Warp Academy',
    url: 'https://www.youtube.com/watch?v=5sAm7McrkA0',
  },
  {
    label: 'When and How to Use Clipping in Mastering - Matty Harris',
    url: 'https://www.youtube.com/watch?v=HMYETfqhgSo',
  },
  {
    label: 'This Changed How I Use Clippers in Mastering Forever - Panorama',
    url: 'https://www.youtube.com/watch?v=1b0TfgnpWzo',
  },
  {
    label: 'Clip Before Limiting - Sage Audio',
    url: 'https://www.youtube.com/watch?v=eHMHZThMW0I',
  },
]);

export const MEAN_VOLUME_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Dynamics, RMS and Peak Levels - iZotope Pro Audio Essentials',
    url: 'https://www.youtube.com/watch?v=_z7VvE_2Sac',
  },
  {
    label: 'Understanding EVERY Volume Measurement (LUFS, RMS, VU, Peak) - The Band Guide',
    url: 'https://www.youtube.com/watch?v=Sg6NDXR9qIo',
  },
  {
    label: 'Peak vs RMS Volume: Why Should You Care? - Underdog Electronic Music School',
    url: 'https://www.youtube.com/watch?v=8f0GU69fVNE',
  },
  {
    label: 'Understanding LUFS vs RMS in Your Mix - Mixed by Inesen',
    url: 'https://www.youtube.com/watch?v=SZ5Mvy14Utw',
  },
  {
    label: 'All Your Audio Meters Explained (LU, LUFS and more) - Next Level Sound',
    url: 'https://www.youtube.com/watch?v=DZIrlcIV4PM',
  },
]);

export const MASTERING_CHECKLIST_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Top Signs Your Mix Isn\'t Ready for Mastering - iZotope Are You Listening?',
    url: 'https://www.youtube.com/watch?v=D1_X0BmgDMM',
  },
  {
    label: 'The 4 Fundamentals of a Good Mix (with Dan Worrall) - Audio University',
    url: 'https://www.youtube.com/watch?v=QSvdhuu2orQ',
  },
  {
    label: 'How to Prepare Your Mix for Mastering - Sage Audio',
    url: 'https://www.youtube.com/watch?v=vd81zTPvnMQ',
  },
  {
    label: 'Preparing a Track for Mastering - Streaky',
    url: 'https://www.youtube.com/watch?v=mBVqFyf-rnE',
  },
  {
    label: '4 Signs Your Mix is Ready for Mastering - Will Borza',
    url: 'https://www.youtube.com/watch?v=7udvdxHyRho',
  },
]);

export const CREST_FACTOR_HISTORY_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Clipping to Manage Crest Factor - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=DvszBRX3rtU',
  },
  {
    label: 'Crest Factor and Clipping - Rapid-Fire Q&A - MixbusTv',
    url: 'https://www.youtube.com/watch?v=wtivirKwoG4',
  },
  {
    label: 'Gain Staging for Transparency, Mojo and Peak Control - Mastering Explained',
    url: 'https://www.youtube.com/watch?v=mpDJg1JpNm8',
  },
  {
    label: 'Mastering Crest Factor: Softening Peaks in Audio - E-Clip Music',
    url: 'https://www.youtube.com/watch?v=SLAK1dyfHkQ',
  },
  {
    label: 'RMS Level & How to Increase It - Scope Labs',
    url: 'https://www.youtube.com/watch?v=gHYl9XsDS6c',
  },
]);

export const MID_SIDE_SPECTRUM_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Mid Side EQ Simplified - In The Mix',
    url: 'https://www.youtube.com/watch?v=kEiILPm1VSc',
  },
  {
    label: 'Mid-Side Analysis with SPAN Is Essential - Pulse Academy',
    url: 'https://www.youtube.com/watch?v=MVNsVtVpzCA',
  },
  {
    label: 'Mid Side Demystified - FabFilter',
    url: 'https://www.youtube.com/watch?v=NilfCElGJ2c',
  },
  {
    label: 'Learn Mid Side EQ NOW! (Thank Me Later) - Creative Sauce',
    url: 'https://www.youtube.com/watch?v=buZtSiWf200',
  },
  {
    label: 'Mixing With Your Eyes: Voxengo SPAN Mixing Settings - Dan Worrall',
    url: 'https://www.youtube.com/watch?v=iZrWMv02tlA',
  },
]);

export const LOUDNESS_HISTOGRAM_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'How Loud Should You Master Your Music? - In The Mix',
    url: 'https://www.youtube.com/watch?v=GBqeSbisROU',
  },
  {
    label: 'How to Make Your Song Loud in the Age of Normalization - Sage Audio',
    url: 'https://www.youtube.com/watch?v=P8dzgU5Q4NU',
  },
  {
    label: 'Understanding Loudness Meter Readings (Peak, RMS, LUFS) - One Man And His Songs',
    url: 'https://www.youtube.com/watch?v=ZYhhfkoZ9Ik',
  },
  {
    label: 'LUFS Explained - Music Production Terminology - Ben Kestok',
    url: 'https://www.youtube.com/watch?v=jkH2huVRmjU',
  },
  {
    label: 'Mastering with YouLean Loudness Meter - MAHAL Studio',
    url: 'https://www.youtube.com/watch?v=C2JZrEtr8sw',
  },
]);

export const SPECTROGRAM_LINKS: HelpTooltipLink[] = withAiRankedTutorials([
  {
    label: 'Spectrogram: What to Look Out For - Plugin Boutique (VISION 4X & NOISIA)',
    url: 'https://www.youtube.com/watch?v=oRLMvMAC1oY',
  },
  {
    label: 'What is a Spectrogram? - iZotope Insider Tips',
    url: 'https://www.youtube.com/watch?v=bQfwFoY7FNA',
  },
  {
    label: 'Identifying Audio Problems in the RX Spectrogram - iZotope',
    url: 'https://www.youtube.com/watch?v=UsyRPoCT7Yk',
  },
  {
    label: 'Best Analyzer Plugin for Mixing and Mastering - Matty Harris',
    url: 'https://www.youtube.com/watch?v=L98hS_6JW6g',
  },
  {
    label: 'Spectrograms: an Introduction - National Music Centre',
    url: 'https://www.youtube.com/watch?v=_FatxGN3vAM',
  },
]);
