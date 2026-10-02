# Learning science for a technical teaching game (copied from learnkafka; the rules apply to ClickHouse too)

Research compiled 2026-10-01. Every rule in `GDD.md` traces back to a section here.

## Summary

Two techniques have the strongest evidence: **retrieval practice** and **spacing**. After those come interleaving, self-explanation, worked examples, mastery gating and specific, immediate feedback. Gamification works when it adds challenge, goals and story, and works poorly when it is mostly points and leaderboards. Irrelevant "fun" media, such as decorative animations or music, measurably hurts learning. That matters here because the app has music and sound.

## 1. Techniques with strong evidence

| # | Technique | Finding | Source | Rule for the Kafka game |
|---|---|---|---|---|
| 1 | Retrieval practice | Beats restudying, g≈0.51; beats doing nothing, g≈0.93; works in classrooms, g=0.67; mixing question formats is strongest | Adesope et al. 2017, *RER*; Roediger & Karpicke 2006, *Psych Sci*; Dunlosky et al. 2013 ("high utility") | Every level ends with a 3–5 item recall check, with the animation hidden. Use multiple choice, drag-to-build and typed answers. |
| 2 | Spacing | Spread-out practice beats massed practice (839 assessments). The best gap is roughly 10–20% of the retention interval. | Cepeda et al. 2006, *Psych Bull* 132 | Each concept returns in levels N+2 and N+5, plus a daily 3-card warm-up (Leitner/SM-2 memory strength per concept). |
| 3 | Interleaving | g=0.42 (59 studies); strongest when categories look similar | Brunmair & Richter 2019, *Psych Bull* 145; Rohrer & Taylor 2007 | Review rounds mix confusable pairs (acks=1 vs all, partition vs replica, retention vs compaction) as "diagnose this symptom". |
| 4 | Self-explanation | g=0.55 (69 effects) | Bisra et al. 2018, *Ed Psych Rev* 30 | A short one-tap "why?" after key events such as failover. Keep these rare. |
| 5 | Worked examples → fading | g=0.48; the benefit reverses for experts (expertise reversal) | Barbieri et al. 2023; Sweller 1988; Kalyuga et al. 2003 | Each mechanic goes Watch → Complete the last step → Solo. A pre-check lets experts skip. |
| 6 | Multimedia / dual coding | Coherence d≈0.70, segmenting d≈0.70, signaling d≈0.46, pre-training d≈0.46 | Mayer 2009/2017/2021; Clark & Paivio 1991 | Labels sit on the objects. Highlight only what changed. The player controls pacing. 60-second glossary before Level 1. No narration together with identical on-screen text. |
| 7 | ICAP (active engagement) | Interactive > Constructive > Active > Passive | Chi & Wylie 2014, *Ed Psychologist* 49 | Nothing stays passive for more than about 20 seconds. **Predict before the animation plays.** |
| 8 | Productive failure | d=0.36 (166 comparisons) for conceptual understanding and transfer | Sinha & Kapur 2021, *RER* 91 | Challenge-first puzzles (ordering with round-robin fails, then teach keys) that build on what the player tried. |
| 9 | Feedback | d=0.48 (435 studies); task and process feedback beats praise | Wisniewski, Zierer & Hattie 2020; Hattie & Timperley 2007 | A wrong answer replays the simulation and gives a one-line "why". Never a bare "Wrong!". |
| 10 | Mastery learning | ~0.52; helps weaker students most | Kulik et al. 1990, *RER* 60; Bloom 1984 | 80% or more unlocks the next level. Failing gives a remedial variant with new numbers. |
| 11 | Concreteness fading | Concrete → iconic → abstract beats any single representation | Fyfe et al. 2014, *Ed Psych Rev* 26 | Each world moves from metaphor (post office) to boxes and arrows to real config and CLI. |
| 12 | Analogies | Help only with an explicit mapping and its limits pointed out | Richland & Simms 2015, *WIREs Cog Sci* | Mapping card plus a "where the metaphor breaks" note (reading doesn't delete). |
| 13 | Simulations | Exploratory simulations with implicit scaffolding | Wieman, Adams & Perkins 2008, *Science* 322; PhET | A sandbox per world that exposes only the dials relevant so far. |
| 14 | Gamification / flow | Cognitive g=0.49, motivational 0.36, behavioral 0.25. Narrative helps. Challenge predicts learning; immersion does not. | Sailer & Homner 2020; Hamari et al. 2016, *CHB* 54; Csikszentmihalyi 1990 | A narrative mission with incidents. Adaptive difficulty at 70–85% success. Rewards are new tools and powers. |

## 2. Popular but unsupported

- **Learning styles**: no evidence for matching instruction to a style (Pashler et al. 2008, *PSPI* 9). Visuals help everyone because Kafka is spatial. Do not personalise by style.
- **Re-reading / re-watching, highlighting, summarization**: low utility (Dunlosky et al. 2013). A rewatch button is fine but does not count as review.
- **Cramming**: retention is worse than spaced practice (Cepeda et al. 2006).

## 3. Gamification and media pitfalls

- **Extrinsic rewards** tied to completing tasks reduce intrinsic motivation, d≈−0.36 to −0.40 (Deci, Koestner & Ryan 1999).
- **Leaderboards and badges** lowered motivation and exam scores in a classroom study (Hanus & Fox 2015, *C&E* 80). Compare against the player's past self only, and make any social comparison opt-in.
- **Seductive details** (interesting but irrelevant content) hurt retention and transfer, worst for novices (Rey 2012; Sundararajan & Adesope 2020).
- **Background music** gives mixed results: Moreno & Mayer 2000 found harm; de la Mora Velasco et al. 2023 (47 studies) found a small positive average. **Rule:** music plays in menus and the sandbox and is ducked during explanations and quizzes. Every SFX maps to a Kafka event.
- **Immersion ≠ learning** (Hamari et al. 2016). Polish goes into showing the mechanism, not spectacle.

## 4. Design principles (binding for the game)

1. **Predict, then watch.**
2. **Recall check with visuals hidden** at the end of every level.
3. **Spaced review**: N+2, N+5, and a daily 3-card warm-up of the weakest concepts.
4. **Interleave confusable concepts** as "diagnose the symptom".
5. **Watch → Complete → Solo**, skippable with a pre-check.
6. **Challenge-first** puzzles for big concepts.
7. **Concreteness fading**: metaphor → icons → real Kafka, plus a mapping card.
8. **Contiguity, signaling, segmenting**: no autoplay longer than about 20 seconds.
9. **Glossary pre-training** before Level 1.
10. **Feedback replays the mechanism.**
11. **Rare one-tap "why?"** prompts.
12. **80% mastery gate**, with remedial variants.
13. **Flow**: adaptive difficulty at 70–85% success; narrative mission; competence rewards.
14. **Meaningful audio**: SFX means a Kafka event; music ducks during learning; mute is always visible.
15. **No global leaderboards**, no rewards for showing up, no learning-style personalisation.
