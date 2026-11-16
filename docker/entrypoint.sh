#!/bin/sh
# Container entrypoint, also installed as the `thelounge` command.
#
# Started as root (the default), it runs The Lounge as PUID:PGID (default
# 1000:1000), handing the data directory to that user first if needed.
# Started as another user (`--user`, Kubernetes, OpenShift), it changes nothing
# and runs The Lounge as that user.
set -eu

log() {
	echo "[entrypoint] $*" >&2
}

die() {
	log "error: $*"
	exit 1
}


is_uint() {
	case "$1" in
		'' | *[!0-9]*) return 1 ;;
	esac
}

has_data() {
	[ -e "$1/config.js" ] || [ -d "$1/users" ]
}

# As the `thelounge` command (docker exec), or for The Lounge's own commands
# and options (`docker run image --version`, `... add <name>`), run The Lounge.
# Anything else (`docker run -it image sh`) runs as given.
if [ "$(basename "$0")" = thelounge ]; then
	set -- node /app/index.js "$@"
	log() { :; } # log only when starting the container
else
	case "${1:-start}" in
		-* | start | help | list | add | remove | reset | edit | storage | \
			install | uninstall | upgrade | outdated)
			set -- node /app/index.js "$@" ;;
	esac
fi

if [ -n "${UMASK:-}" ]; then
	case "$UMASK" in
		*[!0-7]*) die "UMASK must be octal, like 022 (got '$UMASK')" ;;
	esac
	umask "$UMASK"
fi

# Data folder of the linuxserver-style images: used when it holds data and
# THELOUNGE_HOME was left at its default, which is empty
default_home=/var/opt/thelounge
if [ "$THELOUNGE_HOME" = "$default_home" ] && has_data /config; then
	if has_data "$default_home"; then
		log "/config also holds data, but $default_home is used (set THELOUNGE_HOME=/config to use it)"
	else
		THELOUNGE_HOME=/config
		export THELOUNGE_HOME
		log "found data in /config and none in $default_home: using /config"
	fi
fi

uid=${PUID:-1000}
gid=${PGID:-1000}
is_uint "$uid" || die "PUID must be a number (got '$uid')"
is_uint "$gid" || die "PGID must be a number (got '$gid')"

if [ "$(id -u)" != 0 ]; then
	if [ -n "${PUID:-}${PGID:-}" ] && [ "$(id -u):$(id -g)" != "$uid:$gid" ]; then
		log "running as $(id -u):$(id -g) (set by --user); PUID/PGID ignored"
	fi
	exec "$@"
fi

# setpriv needs CAP_SETUID and CAP_SETGID (bits 7 and 6)
cap_eff=$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status)
if [ $((0x$cap_eff & 0xc0)) -ne 192 ]; then
	die "started as root without CAP_SETUID/CAP_SETGID; add them (--cap-add) or start as non-root with --user $uid:$gid"
fi

# Give the data directory to uid:gid, once: the top folder's owner is the
# marker, so it is changed last and a completed change is not repeated on
# the next start. Without PUID/PGID, only an empty folder owned by root (one
# that docker created for a bind mount) is changed. -h and -R never follow
# symbolic links out of the folder.
home=$THELOUNGE_HOME
mkdir -p "$home"
owner=$(stat -c %u:%g "$home")
if [ "$owner" != "$uid:$gid" ]; then
	if [ -n "${PUID:-}${PGID:-}" ]; then
		log "changing owner of $home from $owner to $uid:$gid, this may take a while on large folders"
		find "$home" -mindepth 1 -maxdepth 1 -exec chown -hR "$uid:$gid" {} +
		chown -h "$uid:$gid" "$home"
	elif [ "$owner" = 0:0 ] && [ -z "$(ls -A "$home")" ]; then
		log "changing owner of empty $home from root to $uid:$gid"
		chown -h "$uid:$gid" "$home"
	fi
fi

if [ "$uid" = 0 ]; then
	log "warning: running as root (PUID=0)"
fi

# HOME is /root here; give the user one it can write (npm cache for plugins)
if [ "$uid" = 1000 ]; then
	HOME=/home/node
elif [ "$uid" != 0 ]; then
	HOME=/tmp
fi
export HOME

exec setpriv --reuid="$uid" --regid="$gid" --clear-groups "$@"
