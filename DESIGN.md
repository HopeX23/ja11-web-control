# JA11 interaction and industrial graphic design principles

This interface treats the JA11 as an audio instrument rather than a generic
settings website. Its visual system follows the task: inspect, adjust, audition,
compare, and only then commit parameters to hardware.

## Product problem

The user must be able to answer five questions without interpretation:

1. Is the JA11 connected and synchronized?
2. What response is currently configured?
3. What has changed locally?
4. Which settings are active for listening?
5. Have those settings been written to persistent device memory?

## Principles

1. **Purpose before style.** Layout and emphasis follow the tuning workflow,
   not a reusable landing-page composition.
2. **The response is the object.** The frequency-response plot is primary;
   numeric fields are the precision layer beneath it.
3. **Control and feedback stay adjacent.** Dragging a band updates its exact
   fields and response immediately.
4. **State is always visible.** Connection, synchronization, dirty state,
   audition state, writing, and restart behavior use explicit language.
5. **Persistent actions are distinct.** Listening applies volatile DSP state;
   saving uses a separate, visually dominant hardware commit action.
6. **Reversible exploration.** Undo, redo, device-value restoration, and A/B
   comparison support the short duration of auditory memory.
7. **Semantic color only.** Orange marks the calculated response; green,
   amber, and red are reserved for state. Band colors remain stable identifiers.
8. **Instrument typography.** Tabular numerals, aligned units, compact metadata,
   and restrained hierarchy support scanning and comparison.
9. **Structure without card inflation.** Rules, grid, alignment, and background
   planes create hierarchy instead of repeated rounded containers.
10. **Precision remains accessible.** Every field is labeled, plot handles are
    keyboard-adjustable sliders, focus is visible, and status does not rely on
    color alone.
11. **Different state domains stay distinct.** Device volume, USB mode, active
    EQ program, and the editable User 1 draft are named separately; PEQ preamp
    is never presented as hardware volume.
12. **Risk changes the interaction.** Volume is staged before application and
    large increases require a second action. USB-reenumerating settings announce
    the restart. Read-only stream and firmware values cannot be mistaken for
    controls.
13. **Invalid input never becomes device state.** Temporary typing states are
    visible and block Apply/Save. Leaving a field restores its previous value
    when empty or limits a numeric overflow; imported files and protocol writes
    are rejected rather than silently corrected.

## Dark mode

The light zinc panel is the product's canonical visual expression. Night mode
is not a black repaint of that object; it changes the lighting model from a
reflective bench instrument to a cockpit display in a dark room.

Large surfaces emit almost no light. Structural rules and inactive band colors
recede, while current values, operable controls, connection and write states,
and the response curve retain strong local contrast. The curve gets the only
signal-like glow, kept narrow enough that labels and grid intersections remain
sharp. Secondary copy stays readable rather than becoming decorative dark-gray
text. In short: night mode hides the enclosure, not the information.

The interface uses Day/Night language because the modes serve different ambient
conditions. The initial theme follows the operating-system preference and a
manual choice is retained locally.

## Visual reference

The system draws from industrial control panels, laboratory audio equipment,
DIN-style labeling, and Swiss information design: neutral material colors,
hard alignment, concise labeling, and one purposeful signal color. It avoids
decorative gradients, oversized marketing copy, floating cards, and generic
"technology" styling.
