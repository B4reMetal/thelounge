# The Lounge (fHori)

A fork of @tetrahydroc's [The Lounge](https://github.com/tetrahydroc/thelounge),
the self-hosted web IRC client.

## What's different

- Fast search across your whole history, and jump straight to any result or mention
- Long histories load quickly and scroll back without limit
- Security fixes: uploads need a logged-in session, bad data from an IRC server
  or a browser can't take the server down, and the Docker image runs as a normal
  user
- Shoutbox messages relayed by tracker bots show the real sender
- Right-click a user to open their tracker profile
- Netsplits and mass reconnects collapse into one line
- Direct messages get their own section in the sidebar, with pinning
- Uploads to Catbox, Zipline, rustypaste and others, or local with auto-delete
- Reply to a message, `/rainbow`, `/cleartopic`

## Docker

```yaml
services:
  thelounge:
    image: ghcr.io/fhori/thelounge:latest
    environment:
      - PUID=1000
      - PGID=1000
    volumes:
      - ./thelounge:/var/opt/thelounge
    ports:
      - "9000:9000"
    restart: unless-stopped
```

Add a user with `docker compose exec thelounge thelounge add <name>`.

`latest` is the newest release. Pin a version like `2026.11.0` to upgrade on your
own schedule, or use `edge` for the newest unreleased changes.
More options in [docs/DOCKER.md](docs/DOCKER.md).

## Coming from another version

Back up your data folder first. Your message history is upgraded on first start,
and other versions of The Lounge can't read it afterwards. A command to convert it
back is [in progress](https://github.com/fHori/thelounge/pull/11).

## From source

Needs Node.js 22.

```sh
git clone https://github.com/fHori/thelounge.git
cd thelounge
corepack enable
yarn install
NODE_ENV=production yarn build
yarn start
```

## Configuration

The [The Lounge docs](https://thelounge.chat/docs) apply. Options specific to this
fork are explained in [`defaults/config.js`](defaults/config.js).

## Reporting issues

Found a bug? [Open an issue](https://github.com/fHori/thelounge/issues).
For security problems, please don't open a public issue; see
[SECURITY.md](SECURITY.md).

## Development

This project leverages AI-assisted development workflows. All architecture,
logic, and code are planned, reviewed, and audited by human maintainers,
backed by automated test suites.

## License

MIT
