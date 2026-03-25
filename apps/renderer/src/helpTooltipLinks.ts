import type { HelpTooltipLink } from './HelpTooltip';

/**
 * Curated YouTube tutorial links for mastering-related help tooltips.
 * Each array contains 3 videos from well-known audio educators.
 *
 * IMPORTANT: Every video ID must be verified to return HTTP 200 from
 * https://img.youtube.com/vi/<ID>/mqdefault.jpg — otherwise the
 * thumbnail will show a grey placeholder instead of an actual image.
 */

export const LUFS_LINKS: HelpTooltipLink[] = [
  {
    label: 'LUFS Explained - Music Production Terminology - Ben Kestok',
    url: 'https://www.youtube.com/watch?v=jkH2huVRmjU',
  },
  {
    label: "You don't need to master to -14 LUFS - iZotope",
    url: 'https://www.youtube.com/watch?v=SfVchGaKqmo',
  },
  {
    label: 'Loudness LUFS & RMS in Mastering Explained - mymixlab',
    url: 'https://www.youtube.com/watch?v=naNOHSj6ABI',
  },
];

export const TRUE_PEAK_LINKS: HelpTooltipLink[] = [
  {
    label: 'What is True Peak vs Absolute Peak and Why It Matters - Sage Audio',
    url: 'https://www.youtube.com/watch?v=3yovLokwNMs',
  },
  {
    label: 'True Peak Limiting: What You Need to Know - Streaky',
    url: 'https://www.youtube.com/watch?v=IsFdGr3VeL0',
  },
  {
    label: 'True Peak Limiting Explained - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=4wm1B76pc6k',
  },
];

export const LRA_LINKS: HelpTooltipLink[] = [
  {
    label: 'Dynamic Range LRA in Mixing Explained - Sound Freak Studios',
    url: 'https://www.youtube.com/watch?v=CBTCdDVgpLQ',
  },
  {
    label: 'Mastering Loudness: Unlocking LUFS for Perfect Mixes - Rapid Flow',
    url: 'https://www.youtube.com/watch?v=d8WRQu_hjKQ',
  },
  {
    label: 'How Loud Should You Master Your Music? - Cableguys',
    url: 'https://www.youtube.com/watch?v=gFesyL54K2o',
  },
];

export const STEREO_CORRELATION_LINKS: HelpTooltipLink[] = [
  {
    label: 'How to Understand a Phase Correlation Meter - AM Music',
    url: 'https://www.youtube.com/watch?v=180X8yzIskE',
  },
  {
    label: 'Stop Mixing Out-of-Phase Audio NOW - Martin Rieger',
    url: 'https://www.youtube.com/watch?v=fOz3sliiC9o',
  },
  {
    label: 'How To Use A Stereo Vectorscope Meter - Cableguys',
    url: 'https://www.youtube.com/watch?v=z7_yMcomycw',
  },
];

export const SPECTRUM_ANALYZER_LINKS: HelpTooltipLink[] = [
  {
    label: 'How To Mix With a Spectrum Analyser - SPAN Tutorial - In The Mix',
    url: 'https://www.youtube.com/watch?v=Enj39FWxHJ4',
  },
  {
    label: 'How to Use a Spectrum Analyzer for Better Mixes - Music Business Advice',
    url: 'https://www.youtube.com/watch?v=5TQXbuEQWi8',
  },
  {
    label: "Don't Make This Mistake With a Spectrum Analyzer - Sam Smyers",
    url: 'https://www.youtube.com/watch?v=SvGdIX3FDBs',
  },
];

export const LEVEL_METER_LINKS: HelpTooltipLink[] = [
  {
    label: 'Understanding LUFS vs RMS in Your Mix - Mixed by Inesen',
    url: 'https://www.youtube.com/watch?v=SZ5Mvy14Utw',
  },
  {
    label: 'Peak vs RMS Compression Explained - Mixing Lessons',
    url: 'https://www.youtube.com/watch?v=1GrB41xj26Y',
  },
  {
    label: 'Loudness LUFS & RMS in Mastering Explained - mymixlab',
    url: 'https://www.youtube.com/watch?v=naNOHSj6ABI',
  },
];

export const WAVEFORM_LINKS: HelpTooltipLink[] = [
  {
    label: "What's Wrong With This Waveform for Mastering? - Distinct Mastering",
    url: 'https://www.youtube.com/watch?v=pj7tMtpD0jk',
  },
  {
    label: '2 Golden Rules of Mastering EQ - Streaky',
    url: 'https://www.youtube.com/watch?v=1VuFSrI_s1s',
  },
  {
    label: 'Wider & Warmer Masters - Waves Audio',
    url: 'https://www.youtube.com/watch?v=q_w9rxXL4Bc',
  },
];

export const VECTORSCOPE_LINKS: HelpTooltipLink[] = [
  {
    label: 'How To Use A Stereo Vectorscope Meter - Cableguys',
    url: 'https://www.youtube.com/watch?v=z7_yMcomycw',
  },
  {
    label: '5 Stereo Width Tips For Wider Mixes - Cableguys',
    url: 'https://www.youtube.com/watch?v=Uv8Q-m7RDG8',
  },
  {
    label: 'Audiophile Stereo Imaging Test - M. Zillch',
    url: 'https://www.youtube.com/watch?v=N02Y7vaVDNo',
  },
];

export const PLATFORM_NORMALIZATION_LINKS: HelpTooltipLink[] = [
  {
    label: 'Debunking -14 LUFS Spotify Normalization - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=vLYK0VQq4B4',
  },
  {
    label: "DON'T DO -14 LUFS - Streaky",
    url: 'https://www.youtube.com/watch?v=aO0dR0wOIkk',
  },
  {
    label: 'Spotify Loudness Explained - URM Academy',
    url: 'https://www.youtube.com/watch?v=RGktG9qbJGw',
  },
];

export const REFERENCE_TRACK_LINKS: HelpTooltipLink[] = [
  {
    label: 'Mixing References with Shawn Everett - Mix with the Masters',
    url: 'https://www.youtube.com/watch?v=dok10GRuBMs',
  },
  {
    label: 'Mastering with a Reference Track using Audiolens - iZotope',
    url: 'https://www.youtube.com/watch?v=IpjL-hCPBEE',
  },
  {
    label: 'What Songs Do You Use For Referencing? - Help Me Devvon',
    url: 'https://www.youtube.com/watch?v=upgTHYrFHTA',
  },
];

export const MID_SIDE_LINKS: HelpTooltipLink[] = [
  {
    label: 'Mid Side EQ Simplified - In The Mix',
    url: 'https://www.youtube.com/watch?v=kEiILPm1VSc',
  },
  {
    label: 'What is Mid/Side Processing? - Matty Harris',
    url: 'https://www.youtube.com/watch?v=peUoYLk2BoQ',
  },
  {
    label: 'Mid-Side Magic - Streaky',
    url: 'https://www.youtube.com/watch?v=Q7-vDealMF8',
  },
];

export const K_METERING_LINKS: HelpTooltipLink[] = [
  {
    label: 'K-System Metering Introduction - MeterPlugs',
    url: 'https://www.youtube.com/watch?v=GnREPzUfUgU',
  },
  {
    label: 'Bob Katz - Loudness: War & Peace - J Wedel',
    url: 'https://www.youtube.com/watch?v=u9Fb3rWNWDA',
  },
  {
    label: 'Bob Katz on Mastering - SAE Institute',
    url: 'https://www.youtube.com/watch?v=uCiNSSa2oT8',
  },
];

export const CREST_FACTOR_LINKS: HelpTooltipLink[] = [
  {
    label: 'Clipping to Manage Crest Factor - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=DvszBRX3rtU',
  },
  {
    label: 'Peak, Crest Factor & Loudness Explained - MIXXIN Academy',
    url: 'https://www.youtube.com/watch?v=-1_2jHg1AHI',
  },
  {
    label: 'Mastering Crest Factor: Softening Peaks in Audio - E-Clip Music',
    url: 'https://www.youtube.com/watch?v=SLAK1dyfHkQ',
  },
];

export const DC_OFFSET_LINKS: HelpTooltipLink[] = [
  {
    label: 'What Is DC Offset? - Sweetwater',
    url: 'https://www.youtube.com/watch?v=40rKM0rbqeA',
  },
  {
    label: 'How To Fix DC Offset Using Any EQ - David Dumais Audio',
    url: 'https://www.youtube.com/watch?v=Y2rQxw4IaSo',
  },
  {
    label: 'DC Offset Explained - Beat School',
    url: 'https://www.youtube.com/watch?v=iKLEjrtHOTs',
  },
];

export const DYNAMIC_RANGE_LINKS: HelpTooltipLink[] = [
  {
    label: 'The Loudness War - Matt Mayfield Music',
    url: 'https://www.youtube.com/watch?v=3Gmex_4hreQ',
  },
  {
    label: 'How Dynamic Range & the Loudness War is Deceiving You - Chill Duder',
    url: 'https://www.youtube.com/watch?v=isSCFVXyrao',
  },
  {
    label: 'The Importance of Preserving Dynamic Range - Thomas Tellem',
    url: 'https://www.youtube.com/watch?v=TERNZ9QOFI8',
  },
];

export const TONAL_BALANCE_LINKS: HelpTooltipLink[] = [
  {
    label: 'How to Use Tonal Balance Control for Mixing & Mastering - Splice',
    url: 'https://www.youtube.com/watch?v=Y1kTO5KW17E',
  },
  {
    label: 'Get a Pro Sounding Mix with Tonal Balance Control - iZotope',
    url: 'https://www.youtube.com/watch?v=QruneruRYsc',
  },
  {
    label: 'Tonal Balance Helps Your Track Sound Great Everywhere - iZotope',
    url: 'https://www.youtube.com/watch?v=vwUZs4TEAdI',
  },
];

export const LOUDNESS_HISTORY_LINKS: HelpTooltipLink[] = [
  {
    label: 'The Ultimate Loudness Tutorial - SoundOracle',
    url: 'https://www.youtube.com/watch?v=hbYtzaRhAX0',
  },
  {
    label: 'LUFS Explained - Music Production Terminology - Ben Kestok',
    url: 'https://www.youtube.com/watch?v=jkH2huVRmjU',
  },
  {
    label: 'Understanding LUFS for Mixing and Mastering - Sonic Gold Productions',
    url: 'https://www.youtube.com/watch?v=rbYvUGkdUGk',
  },
];

export const CLIP_COUNT_LINKS: HelpTooltipLink[] = [
  {
    label: 'Hard Clipping vs Soft Clipping & Oversampling Explained - Radium Records',
    url: 'https://www.youtube.com/watch?v=yDQ7C92REGo',
  },
  {
    label: 'The Science of Clipping: The ULTIMATE Tool for Loudness - Warp Academy',
    url: 'https://www.youtube.com/watch?v=5sAm7McrkA0',
  },
  {
    label: 'Clipping vs Limiting Explained - Cableguys',
    url: 'https://www.youtube.com/watch?v=aFe9Gv5YvuI',
  },
];

export const MEAN_VOLUME_LINKS: HelpTooltipLink[] = [
  {
    label: 'Dynamics, RMS and Peak Levels - iZotope Pro Audio Essentials',
    url: 'https://www.youtube.com/watch?v=_z7VvE_2Sac',
  },
  {
    label: 'Understanding EVERY Volume Measurement (LUFS, RMS, VU, Peak) - The Band Guide',
    url: 'https://www.youtube.com/watch?v=Sg6NDXR9qIo',
  },
  {
    label: 'Understanding LUFS vs RMS in Your Mix - Mixed by Inesen',
    url: 'https://www.youtube.com/watch?v=SZ5Mvy14Utw',
  },
];

export const MASTERING_CHECKLIST_LINKS: HelpTooltipLink[] = [
  {
    label: '4 Signs Your Mix is Ready for Mastering - Will Borza',
    url: 'https://www.youtube.com/watch?v=7udvdxHyRho',
  },
  {
    label: 'Is Your Mix Finished? Do This to Find Out - Streaky',
    url: 'https://www.youtube.com/watch?v=kKRKQMeqW7g',
  },
  {
    label: 'Mastering Pre-Release Checklist - Audio Sweetener',
    url: 'https://www.youtube.com/watch?v=drmyvhW-8ys',
  },
];

export const CREST_FACTOR_HISTORY_LINKS: HelpTooltipLink[] = [
  {
    label: 'Mastering Crest Factor: Softening Peaks in Audio - E-Clip Music',
    url: 'https://www.youtube.com/watch?v=SLAK1dyfHkQ',
  },
  {
    label: 'Clipping to Manage Crest Factor - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=DvszBRX3rtU',
  },
  {
    label: 'Peak, Crest Factor & Loudness Explained - MIXXIN Academy',
    url: 'https://www.youtube.com/watch?v=-1_2jHg1AHI',
  },
];

export const MID_SIDE_SPECTRUM_LINKS: HelpTooltipLink[] = [
  {
    label: 'Mid Side EQ Simplified - In The Mix',
    url: 'https://www.youtube.com/watch?v=kEiILPm1VSc',
  },
  {
    label: 'Depth Tricks They All Use (Why Your Mix Sounds Flat) - Streaky',
    url: 'https://www.youtube.com/watch?v=rqMI1w8i3OA',
  },
  {
    label: 'What is Mid/Side Processing? - Matty Harris',
    url: 'https://www.youtube.com/watch?v=peUoYLk2BoQ',
  },
];

export const LOUDNESS_HISTOGRAM_LINKS: HelpTooltipLink[] = [
  {
    label: 'The Ultimate Loudness Tutorial - SoundOracle',
    url: 'https://www.youtube.com/watch?v=hbYtzaRhAX0',
  },
  {
    label: 'LUFS Explained - Music Production Terminology - Ben Kestok',
    url: 'https://www.youtube.com/watch?v=jkH2huVRmjU',
  },
  {
    label: 'How Loud Should You Master to? - Panorama Mixing & Mastering',
    url: 'https://www.youtube.com/watch?v=vLYK0VQq4B4',
  },
];

export const SPECTROGRAM_LINKS: HelpTooltipLink[] = [
  {
    label: 'Spectrogram: What to Look Out For - Plugin Boutique',
    url: 'https://www.youtube.com/watch?v=oRLMvMAC1oY',
  },
  {
    label: 'Spectrograms: an Introduction - National Music Centre',
    url: 'https://www.youtube.com/watch?v=_FatxGN3vAM',
  },
  {
    label: 'Identifying Audio Problems in the Spectrogram - iZotope RX',
    url: 'https://www.youtube.com/watch?v=O99_U3TnM0E',
  },
];
