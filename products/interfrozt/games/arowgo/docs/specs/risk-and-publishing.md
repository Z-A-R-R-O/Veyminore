# Risks, budget and publishing review

Imported baseline · Source masterplan 2.1 · Organized 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page preserves source sections 18, 19, 20. Original section numbers are retained for traceability. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 18. Privacy, platform and age-related publishing safeguards

If the founder or intended account operator is under 18 at the time of publishing, account ownership, payments and any legal arrangement must be handled transparently by an eligible adult. Re-check the actual age and account status before applying; do not rely on assumptions in this plan.

## 18.1 Publishing account

- Google Play currently requires a developer account registrant to be at least 18 years old. If the founder is under 18, an eligible adult must genuinely register, own and manage the publishing account and accept the legal responsibilities.
- Google states that developer account ownership cannot simply be transferred. Set up the correct owner from the beginning; do not create an account in the wrong person's name as a temporary workaround.
- Do not misrepresent account ownership, identity, address, tax or payment details.
- Put IP ownership, code/assets contribution, access, revenue allocation, expenses and decision rights in writing.
- Have a parent/guardian review the arrangement and seek qualified local advice where needed.

For new personal Play Console accounts, Google currently documents a closed-testing requirement of at least 12 testers continuously opted in for 14 days before applying for production access. Verify the requirement against the actual account type and current Play Console guidance.

Reference: https://support.google.com/googleplay/android-developer/answer/14151465

## 18.2 Advertising and payments

- AdMob publishers must be at least 18. If the intended publisher is under 18, Google says a parent or guardian may apply using their own Google Account; approved payments are issued in that adult's name. An adult teammate is not automatically a substitute for the required parent/guardian arrangement.
- Keep payments, taxes, expenses and ownership transparent.
- Verify purchase tokens/receipts server-side and never grant digital goods from client-only confirmation.

## 18.3 Privacy and safety

- Determine the actual target audience before store declarations.
- Do not claim the game is for children unless the product and compliance plan supports that.
- Collect the minimum information necessary.
- Avoid open chat in the early product.
- Provide accurate privacy disclosures.
- Review all SDK data collection.
- Apply relevant Indian privacy requirements and platform policies.
- Seek qualified local advice for the final launch configuration.

## 18.4 Advertising placement

Google Play policy disallows unexpected disruptive interstitials, including ads during gameplay or at the beginning of a level. Use ads only at appropriate natural breaks and recheck current policy before release.

Reference: https://support.google.com/googleplay/android-developer/answer/9857753

## 18.5 Digital goods

For Play-distributed apps, digital goods and in-app features generally require Google Play Billing unless an applicable policy exception exists. Verify current regional policy before implementation.

Reference: https://support.google.com/googleplay/android-developer/answer/9858738

## 18.6 Intellectual property

Before public launch:

- Check exact and similar game names in Google Play and Apple App Store.
- Search relevant trademark records.
- Check domain and social handles.
- Keep evidence of asset licenses.
- Create original levels and paths.
- Do not reproduce another game's exact screen, icon, sound, text, level layouts or protected brand identity.
- AROWGO remains a working name until clearance is complete.

# 19. Budget and operating controls

## 19.1 Initial cost approach

- Use existing development systems.
- Use free tiers for initial hosting and source control where adequate.
- Build original assets in-house.
- Avoid paid user acquisition during early validation.
- Avoid recurring backend services before they are needed.
- Budget the official store registration fee through an eligible adult account holder.
- Record all expenses.

## 19.2 Cost categories to monitor

| Cost | When it may appear |
|---|---|
| Store account | Publishing |
| Domain | Public launch |
| Hosting | Web prototype / landing page |
| Database and functions | Online features |
| Multiplayer hosting | Live multiplayer |
| Analytics/attribution | Growth measurement |
| Art/audio tools | Asset creation |
| Advertising | Only after retention evidence |
| Legal/accounting advice | Agreements and launch compliance |

Do not assume a free tier remains free at scale. Review pricing and usage limits before production use.

# 20. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Gameplay rule ambiguity | Rework across engine and levels | Validate a small prototype first |
| Bent-path collision bugs | Unfair or impossible levels | Logical grid representation and automated tests |
| Random generator creates impossible levels | Player frustration and trust loss | Solver validation; reject unknown boards |
| Endless mode becomes repetitive | Weak retention | Difficulty profiles and structural variation |
| Multiplayer cheating | Unfair results | Server-side replay validation |
| Live multiplayer complexity | Delayed launch and operating burden | Ship asynchronous mode first |
| Cosmetics obscure paths | Reduced readability | Contrast and accessibility gate |
| Too many features | MVP never ships | Strict phase gates |
| Ads harm retention | Churn | Conservative ad placements and cohort tests |
| Under-18 payment/account restrictions | Publishing blocked | Transparent eligible adult/guardian arrangement |
| Name not available | Rebrand cost | Clearance before store assets |
| Team ownership disagreement | Project disruption | Written agreement before substantial work |
| Privacy/SDK issues | Compliance and trust risk | Minimize collection and review SDKs |
| Poor distribution | Few genuine players | Content experiments and beta recruitment |
