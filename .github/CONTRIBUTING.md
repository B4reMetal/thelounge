## Contributing

Welcome to The Lounge, it's great to have you here! We thank you in advance for
your contributions.

### I want to report a bug

- This is a fork of The Lounge. Report bugs in this fork to this repository,
  not to [The Lounge's issue tracker](https://github.com/thelounge/thelounge/issues).
  If you can reproduce the bug in stock The Lounge, it can be reported there.
- If you think you discovered a security vulnerability, **do not open a public
  issue.** Refer to the [security guidelines](/SECURITY.md) instead.

### I want to contribute to the code

- Open pull requests for this fork against its `master` branch. Changes that
  are not specific to this fork are better contributed to stock The Lounge.
- Make sure that your PRs do not contain unnecessary commits or merge commits.
  [Squash commits](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History)
  whenever possible.
- [Rebase](https://git-scm.com/book/en/v2/Git-Branching-Rebasing) (instead of
  merge) outdated PRs on the `master` branch.
- Give extra care to your commit messages. Use the [imperative present
  tense](https://git-scm.com/book/ch5-2.html#Commit-Guidelines) and [follow Tim
  Pope's guidelines](http://tbaggery.com/2008/04/19/a-note-about-git-commit-messages.html).
- Document new options in the comments in `defaults/config.js`, and
  user-visible changes in the README.
- Note that we use prettier on the project. You can set up IDE plugins to format
  on save ([see VS Code one here](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)).
- We have a git hook to automatically run prettier before commit, in case you don't install the plugin.
- If for any reason, prettier does not work for you, you can run `yarn format:prettier` and that should format everything.
