# The Lounge (fHori fork)

A self-hosted web IRC client. This is a fork of
[The Lounge](https://thelounge.chat/), based on The Lounge 4.4.x, with changes
aimed mostly at private tracker IRC networks and large message histories.

It is a fork of a fork:

- [The Lounge](https://github.com/thelounge/thelounge), the original project.
- [tetrahydroc/thelounge](https://github.com/tetrahydroc/thelounge), which
  added the shoutbox bridge prettifier, upload backends, the enhanced user list
  and context menu, reply-to-message and more, with work from cmd430 and
  other contributors.
- This fork, which adds full-text search, faster history loading, jump to
  message, configurable tracker profile links, a few fixes picked from stock
  The Lounge, and a Docker image.

It is not an official release of The Lounge. Do not report problems with this
fork to the stock project unless you can reproduce them in stock The Lounge.

## Differences from stock The Lounge

Messages and history

- Search uses an SQLite FTS5 (trigram) index. On an existing history the index
  is built in the background after the upgrade; search falls back to a full
  scan until it is complete.
- Jump to message: open a search result or a mention in its channel, even when
  that part of the history is not loaded.
- Faster history loading: history is paged from storage on demand, with a
  history index on `(network, channel, time)`.
- Mass event detection: bursts of joins/quits from netsplits and reconnects are
  collapsed into one summary message.
- Reply to message button, optionally quoting as plain text.

Bridged shoutbox messages

- Messages relayed from tracker website shoutboxes by bridge bots are shown as
  if the website user had sent them (matchers for Aither, BeyondHD, DarkPeers,
  HUNO, LST, OnlyEncodes+, ReelFliX, UploadCX and others, see
  `client/js/helpers/shoutbox-bridge/matchers.ts`). Basic BBCode is stripped.

User list and sidebar

- Enhanced user list (including server-provided user groups) and an enhanced
  user context menu, both optional.
- Tracker profile links: right-clicking a user on a configured tracker network
  offers a link to their profile on the tracker's website. Users can add their
  own trackers on the Trackers page in the settings.
- Separate direct message section in the sidebar, with pinned queries and a DM
  filter; "Jump to" in the sidebar; compact sidebar option.

File uploads

- Selectable upload backend per user: local (with optional auto-deletion, from
  1 hour to 1 month or a custom time), Catbox, ImageBB, PTScreens, qu.ax, Uguu,
  OnlyImage, ptpimg, XBackBone, Zipline and rustypaste.

Commands

- `/rainbow` (alias `/rgb`, or Ctrl+R, Cmd+R on macOS, if enabled) sends a rainbow-coloured
  message.
- `/cleartopic` clears the channel topic.
- `thelounge storage vacuum` rewrites message databases to return unused space
  to the disk (stop The Lounge first).

Most of the client-side changes can be turned on or off in the client settings.

## Upgrading from stock The Lounge or another fork

> **Back up your data folder first.** On first start, this fork upgrades each
> user's message database (`logs/*.sqlite3`) in place. The upgrade only goes one
> way: stock The Lounge and older images of other forks cannot open an upgraded
> database. Restoring the backup is the only way back.

Your configuration, users and history are otherwise kept. Settings from a newer
stock `config.js` that this fork does not know are reported as `Unknown key` at
startup and ignored.

## Running with Docker

A multi-architecture image (amd64 and arm64) is published to
`ghcr.io/fhori/thelounge`. Tags:

- `latest`: the newest release.
- `YYYY.M.PATCH` and `YYYY.M`: releases (see [`docs/RELEASING.md`](docs/RELEASING.md)).
- `next`: the newest release candidate.
- `edge`: the current `master` branch.
- `sha-<short commit>`: every build.

The image keeps its data in `/var/opt/thelounge` (set `THELOUNGE_HOME` to use
another path), runs as uid 1000 and listens on port 9000. This matches the
stock image, so an existing stock data volume can be mounted as is.

```yaml
services:
  thelounge:
    image: ghcr.io/fhori/thelounge:latest
    volumes:
      - ./thelounge:/var/opt/thelounge
    ports:
      - "9000:9000"
    restart: unless-stopped
```

The host folder must be writable by uid 1000, or set `PUID`/`PGID` (or
`user:`) to its owner. See [`docs/DOCKER.md`](docs/DOCKER.md).

Run commands with the `thelounge` command in the container:

```sh
docker compose exec thelounge thelounge add <name>
docker compose exec thelounge thelounge list
```

## Running from source

Requirements: [Node.js](https://nodejs.org/) 20 or newer (as in `engines` in
`package.json`). The Docker image and CI use Node.js 22, so that is the tested
version. Yarn is provided by Corepack at the version pinned in `package.json`.

```sh
git clone https://github.com/fHori/thelounge.git
cd thelounge
corepack enable
yarn install
NODE_ENV=production yarn build
yarn start
```

Installed this way, no `thelounge` executable is created. Use
`node index <command>` instead, for example `node index add <name>`. It is not
recommended to run The Lounge as root.

## Configuration

The general [documentation of The Lounge](https://thelounge.chat/docs) still
applies. Options added by this fork are described in the comments in
[`defaults/config.js`](defaults/config.js):

- `allowFileUploadBackendSelection`
- `maskFileHost`
- `massEventDetection`
- `trackers` (tracker profile links and bridge matcher scoping; replaces
  `torrentSites` and `defaultTorrentSiteInfo`, which are still read from
  existing configs)
- `debug.logs`

## Development

Follow the steps in "Running from source", then:

- `yarn dev` starts The Lounge with hot module reloading.
- `yarn test` runs the linters and the test suite.
- `yarn lint` runs the linters only. If Prettier complains, run
  `yarn format:prettier`.
- `yarn githooks-install` installs a pre-commit hook that runs Prettier.

## License

The Lounge is released under the [MIT License](LICENSE).
