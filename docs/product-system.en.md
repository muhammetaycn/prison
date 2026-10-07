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
| API connection and quick-generation model | Sets the analysis and prompt source for new single-model generations. |
| Optional table/arena, models, specialties and depth | Sets the real review team for detailed generations. |
| Trying the prompt in another AI | Tests how useful the prompt is for the user's goal. |
| Feedback on the result received | Produces the next version through a real revision. |

Gestures never produce votes, scores or winners. The jury's state relies only on recorded model evaluations. The
difference between a user instruction and the show is explained in the interface in one short sentence.

## Learning and engagement

The request screen offers goal/limit/output hints; because the buttons change the visible text, the person sees how
they are shaping the prompt. The planning stage is a chance to fill in missing context. Saved candidates and
critiques show which proposal changed and why. The result screen makes copying the full text, trying it in the
target AI and giving feedback visible steps.

The task guide uses the goal, expected deliverables and success criteria of the saved version currently being
displayed. It shows an appropriate tool or agent, official setup/download links, the inputs to prepare and ways to
check the result. A request to create an editable airplane or another 3D asset follows a Blender route. Building
software that loads or displays an existing 3D model follows a code/agent route; the guide distinguishes these tasks.
The user can choose where to work. Copying or downloading keeps the original prompt unchanged; the tool choice
changes the guide. The recorded deliverables and criteria remain visible so the user knows what to produce and
verify. A guide prepares the next action; an actual artifact comes from running the work in the chosen tool and
checking the result there.

Guides can be closed and are shown at the relevant stage. A failed record is never presented as a finished prompt;
only review and retry paths are offered. The local engine, a single model and real multi-model work are each
described by their own evidence. AI feelings, thinking traces or guarantees of success are never invented. The
user's control and progress are visible; no hidden pressure, fake success or reward system that makes people feel
they lose something by not continuing is used.

## Personal AI team

The default workflow is **Quick · single model**. It requires no table or arena. Even when a table is configured,
quick mode makes no calls to its preflight, debate or reserve models. The selected AI prepares the prompt and its
final text still undergoes review. Someone who wants a detailed comparison explicitly chooses a table workflow.

The interface and prompt support Turkish, English and Simplified Chinese. The interface language is remembered
in this browser. Changing it preserves saved requests, prompts and the draft's selected prompt language. Prompt
language is a separate generation setting and is stored with the draft.

A connection consists of a provider type, an HTTPS address and a key stored on the server. The model choice is kept
with the connection ID. The analysis model and the target AI that will use the prompt are different concepts. The
table consists of 3–6 separate models; copies of the same model do not count as independent opinions. A specialty
sets that model's review perspective.

Supported: NVIDIA, DeepSeek, OpenAI Responses, Anthropic structured output and OpenAI-compatible Chat Completions
JSON. Where enabled, the table's preflight tests model access; actual calls depend on access to the selected models.
Without enough participation the work gives a clear error. No stand-in
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
immediately repeat the same character's previous clip. The system selects gestures automatically from real events
such as reviewing, proposing, listening, reacting and resting. Users influence the prompt work through goals,
answers, model choices and feedback; they do not select character animations. Replay controls change what is being
watched while the server operation continues independently. `gesture-director.ts` is a tested helper that could be
used for queue/priority handling in the future; it is not connected to the current scene.

Equipment is carried in the wing/hand or on the back; it follows the rig attachment. What a weapon stands for is a
jury criterion: goal alignment, context completeness, clarity of limits, clarity of execution, clarity of output and
target-AI fit. The stage badges have no emoji equipment list. No reward or purchase is shown as if it had happened.

A new clip is added to the same catalog with a unique ID, a category, a duration and keyframes; the automatic gesture
catalog grows with it. A new clip must pass the neutral-ends, finite/bounded joint values, sitting and occupied
wing rules.
