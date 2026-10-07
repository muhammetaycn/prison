# The PRISON product system

**English** · [简体中文](product-system.zh-CN.md) · [Türkçe](product-system.md)

PRISON turns a person's request into a clear task prompt they can use in the AI of their choice. The table and the
arena tell the story of this work as an understandable scene. The user's value comes from keeping their goal and
limits intact, being able to check the proposals and being able to improve the result.

## What does the user control?

| Intervention | Real effect |
| --- | --- |
| Goal, limits that must not change, output format | Goes into the analysis and the prompt contract. |
| Answers to missing-information questions | Updates the task plan and the next prompt. |
| API connection, model, specialty and depth | Decides the analysis/review team of the new generation. |
| Character and gesture command | Plays the joints of the chosen character; viewing pauses. |
| Trying the prompt in another AI | Tests how useful the prompt is for the user's goal. |
| Feedback on the result received | Produces the next version through a real revision. |

Gestures never produce votes, scores or winners. The jury's state relies only on recorded model evaluations. The
difference between a user instruction and the show is explained in the interface in one short sentence.

## Learning and engagement

The request screen offers goal/limit/output hints; because the buttons change the visible text, the person sees how
they are shaping the prompt. The planning stage is a chance to fill in missing context. Saved candidates and
critiques show which proposal changed and why. The result screen makes copying the full text, trying it in the
target AI and giving feedback visible steps.

Guides can be closed and are shown at the relevant stage. A failed record is never presented as a finished prompt;
only review and retry paths are offered. The local engine, a single model and real multi-model work are each
described by their own evidence. AI feelings, thinking traces or guarantees of success are never invented. The
user's control and progress are visible; no hidden pressure, fake success or reward system that makes people feel
they lose something by not continuing is used.

## Personal AI team

A connection consists of a provider type, an HTTPS address and a key stored on the server. The model choice is kept
with the connection ID. The analysis model and the target AI that will use the prompt are different concepts. The
table consists of 3–6 separate models; copies of the same model do not count as independent opinions. A specialty
sets that model's review perspective.

Supported: NVIDIA, DeepSeek, OpenAI Responses, Anthropic structured output and OpenAI-compatible Chat Completions
JSON. Model access is tested in a pre-check; without enough participation the work gives a clear error. No stand-in
model the user did not choose is added to the saved team. Saving the settings does not change an operation in
progress. A revision conflict keeps the form and offers to load the current record.

Keys are in a server file; the file is not encrypted. A key is never in a DTO, a browser draft or an error message.
When the API address changes, the previous key is not carried over automatically. Saving does no remote generation;
it only changes the settings of the next operation.

## Gestures and equipment

`gesture-library.ts` holds 50 different multi-keyframe clips in five groups: greetings, thinking gestures,
presenting, reactions and resting. Clips apply limited angles/motion to the body, head, wing, leg and tail joints.
Every clip starts and ends in a neutral pose. Sitting, carrying items and the reduced-motion preference are
respected.

`scene.ts` picks a clip for the character after a real event. The choice is repeatable in a replay and does not
immediately repeat the same character's previous clip. A user command runs through the scene's `playGesture`; the
interface first clears the visual action, pauses viewing and shows the stage. The camera frames the chosen character
before the clip; the caption names this action as the user's gesture request. With reduced motion the camera does
not move. Meanwhile the server operation keeps running. `gesture-director.ts` is a tested helper that could be used
for queue/priority handling in the future; it is not connected to the current scene.

Equipment is carried in the wing/hand or on the back; it follows the rig attachment. What a weapon stands for is a
jury criterion: goal alignment, context completeness, clarity of limits, clarity of execution, clarity of output and
target-AI fit. The stage badges have no emoji equipment list. No reward or purchase is shown as if it had happened.

A new clip is added to the same catalog with a unique ID, a category, a duration and keyframes; the gesture choice
list grows automatically. A new clip must pass the neutral-ends, finite/bounded joint values, sitting and occupied
wing rules.
