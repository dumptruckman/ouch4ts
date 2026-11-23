# Interpreting OUCH scores

Use a file's cognitive complexity to find code worth inspecting. File size and
function count affect the total. Adding up individual function scores would
double-count nested code.

For a function, read cyclomatic complexity, coverage, and cognitive complexity
together. A function with cyclomatic complexity 2, 50% line coverage, and
cognitive complexity 1 scores 2.5 CRAP and 3.5 OUCH. Raising coverage to 100%
reduces CRAP to 2 and OUCH to 3. Simplifying its control flow can lower the score
further.

Read a comparison alongside the current score. A drop from 100 to 90 can still
leave the function near the top of the report. A change in tests alone can
change its coverage and OUCH.

If a score is missing, check which executable lines the LCOV report attributes to
the function. Nested bodies or several functions on one line can make attribution
ambiguous. Report that uncertainty when explaining an `N/A`.
