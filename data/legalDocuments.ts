// data/legalDocuments.ts
// Comprehensive legal documents for SportsPal

export interface LegalDocument {
  id: string;
  title: string;
  icon: string;
  content: string;
  lastUpdated: string;
}

export const legalDocuments: LegalDocument[] = [
  {
    id: 'community-guidelines',
    title: 'Community Guidelines',
    icon: 'people-outline',
    lastUpdated: 'November 2025',
    content: `**Purpose.** Keep SportsPal respectful, safe, and useful for finding people to play sports with.

**Applies to:** Profiles, usernames, photos, videos, activity listings, chats, reactions, reports, and any in-app behavior—on and off the platform when arranged through SportsPal.

**A. Golden Rules**

**Be respectful.** No harassment, threats, stalking, or intimidation.

**No hate or violence.** Prohibitions include slurs, dehumanization, extremist praise, or incitement.

**No sexual content/nudity.** No explicit or pornographic content; no fetish content; no sexualization of minors (zero tolerance).

**No illegal or dangerous activity.** Weapons trading, drugs, doping substances, fraud, hacking, or instructions to cause harm are banned.

**No doxxing/privacy invasions.** Don't share private info (addresses, IDs, financials, medical data) without consent.

**No scams or spam.** No pyramid schemes, fake giveaways, phishing, malware, mass unsolicited DMs.

**No impersonation or misrepresentation.** Don't claim to be someone you're not; parody must be labeled.

**Accurate activities.** Describe time, place, skill level, costs, weather dependencies truthfully.

**Respect IP.** Only post content you own or have rights to.

**Meet safely.** Follow our Safety Guidelines. Leave if you feel unsafe—always.

**B. Three-Strike Moderation Ladder (with immediate-removal override)**

**Strike 1 (Warning):** Content removal + feature limits (e.g., 24–72h DM/creation restriction).

**Strike 2 (Probation):** 7–30 days suspension of some or all features.

**Strike 3 (Removal):** Permanent ban.

**Immediate Removal:** We may skip steps (e.g., child safety, credible violence threats, severe harassment, doxxing, hate, explicit sexual content).

**Strike decay:** Strikes typically expire after 12 months if no further violations.

**C. Appeals**

**Window:** 14 days from enforcement notice.

**How:** Use in-app "Appeal" on the enforcement banner or email sportspalapplication@gmail.com from your account email.

**What to include:** Post/Activity URL or screenshot, brief explanation, any context.

**Outcome:** We confirm, modify, or reverse within a reasonable time. Decisions after appeal are final.

**D. False Reporting & Abuse of Tools**

Deliberate false reports or brigading may result in strikes or suspension.`,
  },
  {
    id: 'safety-guidelines',
    title: 'Safety Guidelines',
    icon: 'shield-checkmark-outline',
    lastUpdated: 'November 2025',
    content: `Sports and meeting strangers carry risk. Use judgment. SportsPal does not organize, supervise, or vet users. You are solely responsible for your decisions.

**A. Before You Go**

• **Meet public, well-lit, staffed locations.** Tell a friend; share your plan.

• **Verify details.** Time, venue, costs, skill level, weather plan.

• **Check your health & gear.** Warm up, hydrate, bring appropriate shoes/guards/helmet.

• **Trust your instincts.** If something feels off—don't go.

**B. During the Activity**

• Keep valuables minimal; arrange your own transport.

• Leave at any point you feel unsafe or unwell—no explanation needed.

• Follow venue rules and local laws. Be respectful to staff and other players.

**C. After**

• Report concerning behavior or incidents in-app. For emergencies, contact local authorities first.

**Assumption of Risk:** By participating in activities discovered via SportsPal, you voluntarily assume all risks (injury, illness, property loss). See Terms of Service for full release of liability language.`,
  },
  {
    id: 'ip-policy',
    title: 'Intellectual Property Policy',
    icon: 'document-lock-outline',
    lastUpdated: 'November 2025',
    content: `Respect creators and brands. Only upload content you own or have licensed.

**A. Copyright**

**What's not allowed:** Uploading others' photos, videos, event posters, or logo art without permission.

**Takedown notices:** Email sportspalapplication@gmail.com with:

• Your contact info;
• Work claimed infringed;
• Specific infringing material location (profile/activity/chat link and screenshot);
• Good-faith statement;
• Accuracy statement + perjury statement;
• Signature (typed is fine).

**Counter-notice:** If you believe a mistake was made, email us with:

• Your contact info;
• The removed content + prior location;
• Good-faith statement that removal was an error;
• Consent to the jurisdiction of courts where you live (or Athens, Greece if outside the U.S.) and to accept service;
• Signature.

**Repeat infringers:** Accounts repeatedly infringing may be suspended or terminated.

**B. Trademark & Impersonation**

• No misleading use of logos/marks.
• Impersonation of individuals, clubs, or brands is prohibited. Verified parody must be clearly labeled.`,
  },
  {
    id: 'tracking-notice',
    title: 'Tracking & SDKs',
    icon: 'analytics-outline',
    lastUpdated: 'November 2025',
    content: `We use app SDKs, not browser cookies, to run and improve SportsPal.

**A. Categories of SDKs**

**Strictly necessary:** authentication, security, crash reporting, push notifications.

**Performance & analytics:** usage analytics, performance metrics.

**Content safety:** anti-spam/abuse detection, moderation signals.

**Optional/marketing (if added later):** non-essential measurement or A/B testing.

**B. Legal Basis & Consent**

**EEA/UK:** We request consent for non-essential SDKs and rely on legitimate interests for strictly necessary processing.

**Manage preferences:** Settings → Privacy → "Tracking & Diagnostics." Toggle on/off where available.

**C. Your Controls**

• System permissions (Notifications, Location, Photos, Microphone).
• In-app toggles for analytics/diagnostics (where supported).
• We honor legally recognized opt-out signals where required by law.`,
  },
  {
    id: 'reports-appeals',
    title: 'Reports & Appeals',
    icon: 'flag-outline',
    lastUpdated: 'November 2025',
    content: `Use reports for safety, not vendettas. False reporting may lead to enforcement.

**A. How to Report**

In-app "Report" on the profile, activity, or message; or email sportspalapplication@gmail.com with screenshots, links, timestamps.

**B. What We Do**

We triage reports by severity (child safety, threats, doxxing, imminent harm, fraud).

We may restrict content, limit features, or suspend accounts while investigating.

**C. Timelines**

**Urgent safety:** as fast as reasonably possible.

**Standard:** typically within a few business days.

**D. Appeals**

14-day window from enforcement notice. Include context/evidence.

We confirm, modify, or reverse. Repeated appeals without new info may be closed.

**E. Reinstatement**

For permanent bans, you may request review after 12 months with evidence of changed behavior. We are not obligated to reinstate.`,
  },
  {
    id: 'open-source',
    title: 'Open-Source Licenses',
    icon: 'code-slash-outline',
    lastUpdated: 'November 2025',
    content: `SportsPal includes open-source software under third-party licenses (e.g., MIT, Apache-2.0).

**Major Dependencies:**

• React Native (MIT License)
• Expo (MIT License)
• Firebase SDK (Apache-2.0)
• React Navigation (MIT License)
• And many others

We provide an up-to-date list of packages and license texts. If a license requires attribution or source disclosure, we provide it here.

For a complete list of all open-source components and their licenses, please email sportspalapplication@gmail.com.`,
  },
  {
    id: 'law-enforcement',
    title: 'Law Enforcement Guidelines',
    icon: 'shield-outline',
    lastUpdated: 'November 2025',
    content: `We respond to valid legal process. These guidelines are not a promise to preserve or disclose any data and may change.

**A. What We May Have**

**Account info:** email, username, signup date, last login, device info.

**Usage logs:** IPs, timestamps, feature usage.

**Content:** profile, activities, images, messages (not end-to-end encrypted).

**Payments (if applicable):** limited metadata (no full card data).

**B. Legal Process We Accept**

Valid court orders, warrants, subpoenas, or equivalent under applicable law. We require English or Greek (or certified translation).

**Service:** sportspalapplication@gmail.com. We may require official channels for sensitive requests.

**C. Emergency Requests**

For dangers of death or serious physical harm, email with "Emergency Request," include basis, nature of emergency, and specific data sought. We may disclose limited data in good faith.

**D. Preservation Requests**

We may preserve specific data for 90 days upon valid request pending legal process.

**E. User Notice**

We notify users of data requests unless prohibited by law, court order, or risk of harm.

**F. Cross-Border Requests**

We require appropriate treaties or mechanisms where needed (e.g., MLATs). We apply local law and our policies.`,
  },
  {
    id: 'accessibility',
    title: 'Accessibility Statement',
    icon: 'accessibility-outline',
    lastUpdated: 'November 2025',
    content: `We aim to meet WCAG 2.1 AA standards.

**Features:**

• VoiceOver/TalkBack support
• Dynamic type
• Color-contrast targets
• Focus indicators
• Large-tap targets
• Captions (where present)

**Known Limitations:**

Known limitations are tracked in our backlog.

**Contact for Accessibility Help:**

Email sportspalapplication@gmail.com with subject "Accessibility"

We continuously test with assistive technologies and improve based on feedback.`,
  },
  {
    id: 'security',
    title: 'Security & Vulnerability Disclosure',
    icon: 'lock-closed-outline',
    lastUpdated: 'November 2025',
    content: `We welcome good-faith security reports and won't pursue legal action for accidental, non-exploitive findings.

**A. Scope**

Mobile apps, APIs, and endpoints owned by SportsPal. Excludes third-party services and social media pages.

**B. Safe Harbor (Good-Faith)**

• No extortion, no privacy violations, no data exfiltration beyond necessary proof, no service disruption.
• Give us reasonable time to fix before public disclosure.

**C. How to Report**

Email: sportspalapplication@gmail.com (subject "Security Report"). Include steps to reproduce, impact, and test account if used.

We aim to acknowledge within 5 business days and keep you informed.

**D. security.txt**

Contact: mailto:sportspalapplication@gmail.com
Preferred-Languages: en`,
  },
  {
    id: 'event-host-rules',
    title: 'Event Host Rules',
    icon: 'calendar-outline',
    lastUpdated: 'November 2025',
    content: `If you create activities, you're an organizer ("Host").

**A. Host Responsibilities**

• Accurate title, sport, skill level, date/time, venue, cost, and capacity.
• Choose suitable, legal venues; confirm permits if required.
• **Safety first:** recommend appropriate gear; plan for weather/lighting; provide meeting point details.
• No discrimination, hate, or harassment.
• No fake events, bait-and-switch, or last-minute location scams.

**B. Communications & Changes**

• Update participants promptly about changes or cancellations.
• Don't collect off-platform payments in ways that violate app store or local laws.

**C. Reviews & Ratings**

Honest, non-retaliatory reviews. No review manipulation.`,
  },
  {
    id: 'no-show-policy',
    title: 'No-Show & Cancellation Policy',
    icon: 'close-circle-outline',
    lastUpdated: 'November 2025',
    content: `**A. Participant Cancellations**

**Free activities:** cancel anytime but frequent no-shows may earn strikes.

**Paid activities:** cancel by the host-set cutoff (e.g., 24–48h) for a full or partial refund where applicable.

**B. Host Cancellations**

If a host cancels, participants receive a full refund (if paid) via the original payment method (subject to payment processor timelines).

**C. No-Show & Strikes**

Participant no-show = 1 strike; 3 strikes in 90 days may limit RSVPs.

Hosts who frequently cancel may be restricted or removed.

**D. Extenuating Circumstances**

Severe weather, venue closures, verifiable emergencies may waive penalties at our discretion.`,
  },
  {
    id: 'age-safety',
    title: 'Age & Minor Safety',
    icon: 'warning-outline',
    lastUpdated: 'November 2025',
    content: `**Minimum age:** 16 in EEA/UK (or local digital-consent age), 13 elsewhere.

**No sexualization of minors; zero tolerance.**

**Images of minors:** Do not upload without clear consent of a parent/guardian and only in appropriate, non-exploitative contexts (e.g., family sports day).

**Reporting:** Immediately report any child-safety concern. We escalate to authorities where required.

**Family Activities:** If hosts allow "minors welcome," they must specify this, require guardian attendance, and comply with local laws.`,
  },
  {
    id: 'ai-moderation',
    title: 'AI & Automated Moderation',
    icon: 'hardware-chip-outline',
    lastUpdated: 'November 2025',
    content: `**What we use AI for:** detect spam, hate/harassment, adult content; prioritize safety review; surface relevant activities.

**Limits:** AI can make mistakes. False positives/negatives happen.

**Human review:** We blend automation with human moderation where feasible.

**Your rights:** You can appeal automated actions.

**Training:** We do not train public models on your private messages. If we use data to improve our own safety systems, we anonymize/aggregate where possible.

**Opt-outs:** Where required by law, we offer opt-outs or alternatives.`,
  },
  {
    id: 'subscriptions',
    title: 'Subscriptions & Refunds',
    icon: 'card-outline',
    lastUpdated: 'November 2025',
    content: `Key facts: Subscriptions auto-renew until canceled. Prices may change with prior notice.

**A. Billing & Renewal**

• Billed via Apple App Store or Google Play to your store account.
• Renews at the end of each period unless canceled at least 24 hours before renewal.
• If price changes, you'll be notified; continued subscription after the change date means acceptance.

**B. Free Trials**

If offered, trials convert to paid unless canceled before trial ends.

**C. Cancellations & Refunds**

**Cancel:** In your device's subscription manager (App Store / Google Play).

**Refunds:** Governed by Apple/Google policies. Most refunds are processed by the store, not SportsPal.

We may deny service where fraud/abuse of refunds is suspected.

**D. Upgrades/Downgrades**

Proration follows store rules. Features adjust immediately after the store confirms the change.`,
  },
  {
    id: 'advertising',
    title: 'Advertising & Branded Content',
    icon: 'megaphone-outline',
    lastUpdated: 'November 2025',
    content: `**Disclosures:** Sponsored posts must include clear disclosure (e.g., "Ad," "Sponsored").

**Restrictions:** No ads for illegal drugs, weapons, adult content, gambling (where restricted), misleading health claims, discriminatory targeting.

**Data Use:** Advertisers must comply with privacy laws and your terms. No scraping or profiling off-platform via SportsPal data.`,
  },
];

export function getLegalDocumentById(id: string): LegalDocument | undefined {
  return legalDocuments.find(doc => doc.id === id);
}
