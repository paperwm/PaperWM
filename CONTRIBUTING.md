# History / Admins

PaperWM was originally written by @hedning and @olejorgenb. However, they became busy with other things and stepped away from active development. They may return some day, and you might see them around every couple months, but don't ping them and expect a response.

@smichel17 [joined](https://github.com/paperwm/PaperWM/issues/407) to facilitate transitioning PaperWM to a community project. Unfortunately, he's *also* too busy (and doesn't know Gnome Shell's code base well enough) to take over development directly. So, his role is basically to be a trustworthy person (he hopes!) to manage adding more maintainers. Including writing this document (👋).

@jitaa jumped in to help with development in late 2022, having discovered PaperWM around that time. He came from i3wm and quickly fell in love with PaperWM and the concept of scrollable tiling window managers. He's a PaperWM maintainer focused on fixing issues, and developing & implementing requested features that'll make PaperWM a reliable daily driver loved by its users.

## Community Transition

### Concerns

- **Focus** — without one person to enforce the vision of what the software should be, it's easy for it to try and be many different things. End result: software that is inconsistent and difficult to use.
    - Same thing for the code base. End result: difficult to maintain.
- **Trust** — obviously we only want to give permissions to people who we trust not to push malicious (or otherwise bad) code. However, it's difficult for someone to prove they are trustworthy without trusting them first.
- **Momentum** — trying to avoid pitfalls in the first two areas can lead to no actual development progress. For example, long deliberation trying to reach consensus, or a cumbersome contribution process that drives away potential maintainers.

### Plan

To balance those issues, the plan is something like this (details may change):

- Give out write access to the repo fairly easily. If someone makes a number of small contributions, or 1-2 large contributions, invite them as a Collaborator.
- Require all contributions to be via PR. That way it's difficult for anyone to sneak changes in without others noticing.
- Protect branches\*. Require 2 Collaborators to approve a PR before it's merged (so one person can't unilaterally push changes).
    - \*`develop`, `master`, and any branch referenced in the README. Also all tags.
    - If there are not enough active maintainers, maybe relax the 2-person requirement.

### Governance

If it's not clear who will make a decision, it's @smichel17's decision.
My goal is to make as few decisions this way as possible.

Over time we'll add more to this section, as we figure out how we want to work.
