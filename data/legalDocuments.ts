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
**Applies to:** Profiles, usernames, photos, activity listings, chats, messages, and any in-app behavior—on and off the platform when arranged through SportsPal.

**A. Golden Rules**
**Be respectful.** No harassment, threats, stalking, or intimidation.
**No hate or violence.** Prohibitions include slurs, dehumanization, extremist praise, or incitement.
**No sexual content/nudity.** No explicit or pornographic content; no fetish content; no sexualization of minors (zero tolerance).
**No illegal or dangerous activity.** Weapons trading, drugs, doping substances, fraud, hacking, or instructions to cause harm are banned.
**No doxxing/privacy invasions.** Don't share private info (addresses, IDs, financials, medical data) without consent.
**No scams or spam.** No pyramid schemes, fake giveaways, phishing, malware, mass unsolicited messages.
**No impersonation or misrepresentation.** Don't claim to be someone you're not; parody must be clearly labeled.
**Accurate activities.** Describe date, time, location, sport, skill level, participant limits, and any costs truthfully. Update or cancel if plans change.
**Respect IP.** Only post photos and content you own or have rights to.
**Meet safely.** Follow our Safety Guidelines. Leave if you feel unsafe—always.

**B. Three-Strike Moderation Ladder (with immediate-removal override)**
**Strike 1 (Warning):** Content removal + feature limits (e.g., 24–72h chat/creation restriction).
**Strike 2 (Probation):** 7–30 days suspension of some or all features.
**Strike 3 (Removal):** Permanent ban.
**Immediate Removal:** We may skip steps for child safety, credible violence threats, severe harassment, doxxing, hate speech, or explicit sexual content.
**Strike decay:** Strikes typically expire after 12 months if no further violations.

**C. Appeals**
**Window:** 14 days from enforcement notice.
**How:** Email sportspalapplication@gmail.com from your account email with subject "Appeal."
**What to include:** Activity/Profile/Message screenshot or link, brief explanation, any relevant context.
**Outcome:** We confirm, modify, or reverse within a reasonable time. Decisions after appeal are final.

**D. False Reporting & Abuse of Tools**
Deliberate false reports or brigading may result in strikes or suspension.`,
  },
  {
    id: 'safety-guidelines',
    title: 'Safety Guidelines',
    icon: 'shield-checkmark-outline',
    lastUpdated: 'November 2025',
    content: `Sports and meeting people through apps carry risk. Use your best judgment. SportsPal does not organize, supervise, or background-check users. You are solely responsible for your decisions.

**A. Before You Go**
• **Meet in public, well-lit, staffed locations.** Tell a friend; share your plan, location, and who you're meeting.
• **Verify details.** Confirm time, exact meeting point, sport/activity, expected duration, skill level, any costs, and weather plan.
• **Check your health & gear.** Warm up, hydrate, bring appropriate shoes/guards/helmet/equipment for the sport.
• **Trust your instincts.** If something feels off—don't go. You can leave a chat or activity anytime.

**B. During the Activity**
• Keep valuables minimal; arrange your own transport home.
• Leave at any point you feel unsafe or unwell—no explanation needed.
• Follow venue rules and local laws. Be respectful to staff, other players, and the organizer.
• Stay hydrated and pace yourself. Sports injuries can happen—know your limits.

**C. After**
• Report concerning behavior, fake profiles, or incidents in-app using the Report button, or email sportspalapplication@gmail.com.
• For emergencies (injury, assault, theft), contact local authorities first (police, ambulance).

**D. Photo & Location Sharing**
• Your profile photo and approximate location are visible to other users to help you connect.
• Never share your exact home address, workplace, or other sensitive personal information in chats or activity descriptions.

**Assumption of Risk:** By participating in activities discovered via SportsPal, you voluntarily assume all risks including injury, illness, and property loss. See Terms of Service for full release of liability language.`,
  },
  {
    id: 'ip-policy',
    title: 'Intellectual Property Policy',
    icon: 'document-lock-outline',
    lastUpdated: 'November 2025',
    content: `Respect creators and brands. Only upload photos and content you own or have permission to use.

**A. Copyright**
**What's not allowed:** Uploading others' photos, profile pictures, activity images, or copyrighted graphics without permission.
**Profile photos:** Must be a photo of you or your own content. Using someone else's photo is impersonation and violates our Community Guidelines.
**Activity images:** Only use photos you took or have rights to. Stock photos are okay if licensed.

**Takedown notices:** Email sportspalapplication@gmail.com with:
• Your contact info;
• Work claimed infringed;
• Specific infringing material location (profile/activity link and screenshot);
• Good-faith statement that use is not authorized;
• Statement of accuracy under penalty of perjury;
• Signature (typed is acceptable).

**Counter-notice:** If you believe a mistake was made, email us with:
• Your contact info;
• The removed content + prior location;
• Good-faith statement that removal was an error;
• Consent to jurisdiction of courts where you live (or Athens, Greece if outside the U.S.) and to accept service;
• Signature.

**Repeat infringers:** Accounts repeatedly infringing may be suspended or terminated.

**B. Trademark & Impersonation**
• No misleading use of brand logos, team names, or trademarks.
• Impersonation of individuals, clubs, organizations, or brands is prohibited. Verified parody/fan accounts must be clearly labeled.`,
  },
  {
    id: 'tracking-notice',
    title: 'Tracking & SDKs',
    icon: 'analytics-outline',
    lastUpdated: 'November 2025',
    content: `We use app SDKs (software development kits) and analytics services to run and improve SportsPal. We do not use browser cookies since SportsPal is a mobile app.

**A. Categories of SDKs**
**Strictly necessary:** Firebase Authentication (sign in), Firebase Firestore (database), Firebase Storage (photos), Expo push notifications, crash reporting.
**Performance & analytics:** Usage analytics to understand which features are used and improve the app.
**Content safety:** Anti-spam/abuse detection, moderation signals.
**Location services:** To show you nearby activities and users (you can disable location in Settings).

**B. Legal Basis & Consent**
**EEA/UK:** We request consent for non-essential SDKs and rely on legitimate interests for strictly necessary processing.
**Manage preferences:** Go to your device Settings → SportsPal → Permissions to control Location, Notifications, Photos, Camera, and Microphone access.

**C. Your Controls**
• System permissions (Notifications, Location, Photos/Media, Camera, Microphone) can be toggled in your device settings.
• Location can be disabled at any time; this will limit the Discover feature but won't prevent you from viewing activities you've already joined.
• We honor legally recognized opt-out signals where required by law.`,
  },
  {
    id: 'reports-appeals',
    title: 'Reports & Appeals',
    icon: 'flag-outline',
    lastUpdated: 'November 2025',
    content: `Use reports for safety concerns, not personal disputes. False reporting may lead to enforcement against your account.

**A. How to Report**
• In-app: Tap the three dots (•••) on a profile or activity, then select "Report."
• In chats: Long-press a message and select "Report."
• Email: sportspalapplication@gmail.com with screenshots, links, and timestamps.

**B. What We Do**
We triage reports by severity (child safety, threats of violence, doxxing, imminent harm, fraud get priority).
We may restrict content, limit features, or suspend accounts while investigating.
We don't disclose details of other users' enforcement to protect privacy, but we take action when violations are confirmed.

**C. Timelines**
**Urgent safety issues:** As fast as reasonably possible (typically within hours).
**Standard reports:** Typically within 2-5 business days.

**D. Appeals**
14-day window from enforcement notice. Email sportspalapplication@gmail.com with subject "Appeal" and include:
• Your username and account email
• The specific enforcement action (warning, suspension, content removal)
• Context or evidence showing why the decision should be reversed
We confirm, modify, or reverse within a reasonable time. Decisions after appeal are final.
Repeated appeals without new information may be closed.

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
• Expo Auth Session (MIT License)
• Expo Image Picker (MIT License)
• Expo Location (MIT License)
• And many others

We provide attribution for all open-source components as required by their licenses. If a license requires source disclosure or additional notices, we provide them.

For a complete list of all open-source components and their full license texts, please email sportspalapplication@gmail.com with subject "Open Source Licenses."`,
  },
  {
    id: 'law-enforcement',
    title: 'Law Enforcement Guidelines',
    icon: 'shield-outline',
    lastUpdated: 'November 2025',
    content: `We respond to valid legal process. These guidelines are for law enforcement and may change. We are not obligated to preserve or disclose any data without proper legal authority.

**A. What We May Have**
**Account info:** Email, username, profile photo, sports preferences, location (city/neighborhood), signup date, last login, device info.
**Usage logs:** IP addresses, timestamps, feature usage.
**Content:** Profile data, activities created/joined, photos, chat messages (not end-to-end encrypted).
**Location data:** Approximate location used for Discover feature (if permission granted).
**Payments (if applicable):** Limited metadata; no full card data (handled by payment processors).

**B. Legal Process We Accept**
Valid court orders, warrants, subpoenas, or equivalent under applicable law. We require documents in English or Greek (or certified translation).
**Service:** sportspalapplication@gmail.com with subject "Law Enforcement Request." We may require official channels (postal mail, official law enforcement portal) for sensitive requests.

**C. Emergency Requests**
For imminent dangers of death or serious physical harm, email with subject "Emergency Request," include:
• Sworn statement of the emergency nature
• Specific data sought
• Basis for belief that SportsPal has relevant data
We may disclose limited data in good faith without a court order where legally permitted.

**D. Preservation Requests**
We may preserve specific account data for 90 days upon valid request pending formal legal process.

**E. User Notice**
We notify users of data requests unless prohibited by law, court order, sealed warrant, or where notice would create risk of harm.

**F. Cross-Border Requests**
We require appropriate treaties or mechanisms where needed (e.g., MLATs, EU production orders). We apply local law and our policies.`,
  },
  {
    id: 'accessibility',
    title: 'Accessibility Statement',
    icon: 'accessibility-outline',
    lastUpdated: 'November 2025',
    content: `We aim to make SportsPal usable for everyone and target WCAG 2.1 AA standards.

**Features:**
• VoiceOver (iOS) and TalkBack (Android) support for screen readers
• Dynamic text sizing (respects device font size settings)
• Color contrast targets for text readability
• Focus indicators for navigation
• Large touch targets (minimum 44x44 points)
• Alternative text for profile photos and activity images (where provided)

**Known Limitations:**
Some complex UI elements (activity maps, image galleries) may have partial screen reader support. We're actively working to improve these.
Color-only indicators are supplemented with icons or text labels.

**Contact for Accessibility Help:**
If you encounter an accessibility barrier, email sportspalapplication@gmail.com with subject "Accessibility" and describe the issue.
We continuously test with assistive technologies and improve based on user feedback.`,
  },
  {
    id: 'security',
    title: 'Security & Vulnerability Disclosure',
    icon: 'lock-closed-outline',
    lastUpdated: 'November 2025',
    content: `We welcome good-faith security reports and won't pursue legal action for responsible, non-exploitive vulnerability disclosure.

**A. Scope**
SportsPal mobile apps (iOS/Android), APIs, Firebase backend, and services owned by SportsPal.
Excludes third-party services (Apple, Google, Firebase infrastructure itself) and social media pages.

**B. Safe Harbor (Good-Faith Research)**
• No extortion, blackmail, or threats
• No privacy violations or accessing other users' data beyond what's necessary for proof-of-concept
• No data exfiltration or destruction
• No service disruption (DoS/DDoS attacks)
• Give us reasonable time to fix (typically 90 days) before public disclosure
If you follow these rules, we won't pursue legal action and will work with you to understand and fix the issue.

**C. How to Report**
Email: sportspalapplication@gmail.com with subject "Security Report"
Include:
• Detailed steps to reproduce the vulnerability
• Impact assessment (what could an attacker do?)
• Test account used (if applicable)
• Any supporting screenshots, videos, or proof-of-concept code
We aim to acknowledge within 5 business days and keep you informed of our progress.

**D. What We're Interested In**
• Authentication bypasses
• Unauthorized data access
• SQL injection, XSS, or code injection
• Server-side vulnerabilities
• Privilege escalation
• Privacy leaks

**Out of Scope:**
• Social engineering or phishing attacks
• Spam or content policy violations (report these normally)
• Third-party app/service vulnerabilities
• Denial of service attacks

**E. security.txt**
Contact: mailto:sportspalapplication@gmail.com
Preferred-Languages: en`,
  },
  {
    id: 'event-host-rules',
    title: 'Event Host Rules',
    icon: 'calendar-outline',
    lastUpdated: 'November 2025',
    content: `If you create activities on SportsPal, you're an organizer ("Host"). With that comes responsibility.

**A. Host Responsibilities**
• **Accurate information:** Provide correct sport, date, time, location (address or meeting point), skill level, participant limits, and any costs.
• **Suitable venues:** Choose safe, legal, accessible locations. Confirm permits if required (e.g., park reservations, facility bookings).
• **Safety first:** Recommend appropriate gear (helmets, guards, proper footwear). Plan for weather (rain, heat) and lighting (if evening/night). Provide clear meeting point details.
• **No discrimination:** Activities must be open to all who meet the stated requirements (skill level, age if relevant). No discrimination based on race, religion, gender, orientation, disability, or other protected characteristics.
• **No fake events:** Don't create spam activities, bait-and-switch locations, or scam listings.
• **Communication:** Keep participants informed. If plans change or you need to cancel, update the activity or message participants as soon as possible.

**B. Payments & Costs (if applicable)**
• If your activity has costs (court rental, equipment hire), state them clearly upfront.
• Don't collect off-platform payments in ways that violate app store policies, local laws, or create safety risks (e.g., demanding cash transfers before meeting).
• SportsPal does not currently process payments; any payment arrangements are between you and participants.

**C. Cancellations**
• If you must cancel, do so as early as possible and notify all participants.
• Frequent last-minute cancellations may result in restrictions or removal from hosting.

**D. Ratings & Reviews**
• Participants can rate and review activities.
• Be professional and non-retaliatory. Don't manipulate reviews or retaliate against users who leave honest feedback.`,
  },
  {
    id: 'no-show-policy',
    title: 'No-Show & Cancellation Policy',
    icon: 'close-circle-outline',
    lastUpdated: 'November 2025',
    content: `**Note:** SportsPal does not currently process payments or enforce paid activity fees. This policy governs behavior expectations.

**A. Participant Cancellations**
• **Joining activities:** When you RSVP "Join" or "Interested," you're signaling intent to attend. Hosts and other participants plan around you.
• **Canceling:** If you can't make it, leave the activity as early as possible (tap "Leave" on the activity). Don't just not show up.
• **No-shows:** Repeatedly joining activities and not showing up without notice may result in warnings or temporary restrictions on joining new activities.

**B. Host Cancellations**
• If a host cancels an activity, they should notify all participants in the activity chat or by updating the activity status.
• Hosts who frequently cancel last-minute (without valid reasons like weather, emergencies) may be restricted or removed from creating activities.

**C. No-Show Tracking**
• We may track no-shows (participants who RSVP and don't show or cancel).
• **Strike system:** 3+ no-shows in 90 days = warning; continued pattern may limit RSVP abilities.

**D. Extenuating Circumstances**
• Severe weather, venue sudden closures, personal emergencies, or illness are valid reasons.
• If you have a legitimate reason, communicate it. We may waive penalties at our discretion.

**E. Paid Activities (Future)**
• If we introduce paid bookings, cancellation policies (refund windows, deadlines) will be stated clearly on each activity.
• Hosts will set cancellation cutoffs (e.g., 24–48 hours). Late cancellations may forfeit refunds where applicable.`,
  },
  {
    id: 'age-safety',
    title: 'Age & Minor Safety',
    icon: 'warning-outline',
    lastUpdated: 'November 2025',
    content: `**Minimum age:** 16 in EEA/UK (or local digital-consent age whichever is higher), 13 elsewhere. If under 18 (or age of majority in your region), you must have parental/guardian permission.

**Zero tolerance for child exploitation:**
• No sexualization of minors in any form.
• No soliciting, grooming, or inappropriate contact with minors.
• Violations result in immediate permanent ban and reporting to authorities.

**Photos of minors:**
• Do not upload photos of minors (under 18) as your profile photo unless it's you and you meet the minimum age.
• Activity photos showing minors require clear consent from parents/guardians and must be in appropriate, non-exploitative contexts (e.g., family sports events, youth leagues).
• When in doubt, don't upload.

**Reporting child safety concerns:**
• Use in-app Report button or email sportspalapplication@gmail.com with subject "Child Safety Report."
• We escalate to authorities (NCMEC in the U.S., local police, Interpol) as required by law.
• For imminent danger, contact local police or emergency services first.

**Family/Youth activities:**
• If hosts create activities allowing minors, they must:
  - Clearly state "minors welcome" or age range in the description
  - Require parent/guardian attendance for participants under 16
  - Follow local laws regarding supervision, permits, and child safety
  - Not collect personal information from minors without parental consent`,
  },
  {
    id: 'ai-moderation',
    title: 'AI & Automated Moderation',
    icon: 'hardware-chip-outline',
    lastUpdated: 'November 2025',
    content: `**What we use AI/automation for:**
• Detect spam, fake accounts, and mass messaging
• Flag potential hate speech, harassment, or explicit content for review
• Identify fake or inappropriate profile photos
• Surface relevant activities based on location and sports preferences
• Prioritize high-severity safety reports

**Limits & accuracy:**
• AI can make mistakes. False positives (flagging innocent content) and false negatives (missing violations) happen.
• We continuously improve our models, but they're not perfect.

**Human review:**
• We combine automation with human moderation where feasible, especially for serious safety issues.
• High-severity reports (threats, child safety, doxxing) always get human review.

**Your rights:**
• You can appeal any automated enforcement action (see Appeals policy).
• If you believe an AI decision was wrong, explain why in your appeal and we'll review.

**Training & privacy:**
• We do not train public AI models or sell your data to third parties.
• We may use anonymized/aggregated data to improve our own safety systems (e.g., spam detection).
• Private messages are not used for advertising targeting.

**Opt-outs:**
• Where required by law, we offer opt-outs or alternatives to automated decision-making.`,
  },
  {
    id: 'subscriptions',
    title: 'Subscriptions & Refunds',
    icon: 'card-outline',
    lastUpdated: 'November 2025',
    content: `**Note:** SportsPal is currently free. If we introduce subscriptions or premium features in the future, this policy will govern them.

**A. Billing & Renewal**
• Subscriptions would be billed via Apple App Store or Google Play to your store account.
• Auto-renews at the end of each period (monthly, yearly) unless canceled at least 24 hours before renewal.
• If prices change, you'll be notified at least 30 days in advance. Continued subscription after the change date means acceptance.

**B. Free Trials**
• If offered, free trials convert to paid subscriptions unless canceled before trial ends.
• You can cancel during the trial period without charge.

**C. Cancellations & Refunds**
**How to cancel:**
• iOS: Settings → [Your Name] → Subscriptions → SportsPal → Cancel Subscription
• Android: Google Play Store → Menu → Subscriptions → SportsPal → Cancel Subscription
**Refunds:**
• Governed by Apple App Store and Google Play refund policies.
• Most refunds are processed by Apple/Google, not SportsPal directly.
• To request a refund, contact Apple or Google support.
• We may deny future subscriptions where refund abuse or fraud is suspected.

**D. Upgrades/Downgrades**
• Proration follows store rules (Apple/Google).
• Feature access adjusts immediately after the store confirms the change.

**E. What happens when you cancel**
• You retain access until the end of your current billing period.
• After that, premium features (if any) are disabled, but your account and data remain.`,
  },
  {
    id: 'advertising',
    title: 'Advertising & Branded Content',
    icon: 'megaphone-outline',
    lastUpdated: 'November 2025',
    content: `**Note:** SportsPal does not currently display ads or allow sponsored content. If we introduce advertising in the future, this policy will govern it.

**A. Disclosures (if/when applicable)**
• Any sponsored activities or branded content must include clear, conspicuous disclosure (e.g., "Ad," "Sponsored," "Paid partnership").
• Disclosures must appear at the beginning of posts/activities, not buried in descriptions.

**B. Restrictions (if/when we allow ads)**
No ads will be permitted for:
• Illegal drugs or controlled substances
• Weapons, explosives, or ammunition
• Adult content, escort services, or dating services with sexual focus
• Gambling (where restricted by law)
• Misleading health claims, miracle cures, or unregulated supplements
• Discriminatory targeting (based on race, religion, gender, orientation, disability)
• Predatory lending or scams

**C. User Data & Targeting**
• Advertisers must comply with privacy laws (GDPR, CCPA, etc.) and our Terms/Privacy Policy.
• No scraping user data or building off-platform profiles using SportsPal information.
• Any tracking/measurement must comply with our SDK/Tracking policies.

**D. User Controls**
• If we introduce ads, you'll be able to report inappropriate ads and provide feedback on relevance.
• Ad-free subscriptions may be offered in the future.`,
  },
];

export function getLegalDocumentById(id: string): LegalDocument | undefined {
  return legalDocuments.find(doc => doc.id === id);
}
