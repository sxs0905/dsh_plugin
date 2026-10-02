#!/usr/bin/env bash
#
# dsh-plugin-deepseek-balance 本机更新脚本
#
# 更新规则（与需求一致）：
#   1. 查远端 tag：最高 tag 的版本号比已安装版本新 → 更新到那个 tag；
#   2. 版本号相同（或没有更新的 tag）→ 比较 main 最新提交与已安装提交，
#      不同就按 main 更新；
#   3. 两边都一致 → 已是最新，什么都不做。
#
# 只调用「应用自带 CLI」的 `plugin --profile <profile> add`，不改 DSH 源码、
# 不改插件代码。更新后必须重启 DeepSeek Harness 才生效。
#
# 用法:
#   ./update-plugin.sh                  # 检查并在询问后更新 desktop profile
#   ./update-plugin.sh --check          # 只检查，打印将要执行的动作
#   ./update-plugin.sh --yes            # 不询问，直接更新
#   ./update-plugin.sh --profile web     # 指定别的 profile（默认 desktop）
#   ./update-plugin.sh --help
#
set -eu

PACKAGE="dsh-plugin-deepseek-balance"
REPO_URL="https://github.com/sxs0905/dsh_plugin.git"
REPO_SLUG="sxs0905/dsh_plugin"
REPO_PATH="/dsh-plugin-deepseek-balance"          # 包在仓库里的子目录
APP_CLI="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"

PROFILE="desktop"
MODE="apply"          # check | apply
ASSUME_YES="no"

usage() {
	cat <<'TXT'
用法: update-plugin.sh [选项]

  --check           只检查，不更新（打印将要执行的动作与命令）
  --yes             不询问，直接更新
  --profile <名字>  目标 profile，默认 desktop
  --help            显示本帮助

环境变量:
  DSH_HOME          默认为 ~/.dsh
  DSH_BIN           应用自带 CLI 路径，默认自动探测
  HTTPS_PROXY/HTTP_PROXY  若未设置，会尝试 git config http.proxy，再尝试 macOS 系统代理
TXT
}

say() { printf '%s\n' "$*"; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

# ---------- 参数 ----------
while [ $# -gt 0 ]; do
	case "$1" in
		--check) MODE="check" ;;
		--yes|-y) ASSUME_YES="yes" ;;
		--profile)
			[ $# -ge 2 ] || die "--profile 需要一个值"
			PROFILE="$2"
			shift
			;;
		--help|-h) usage; exit 0 ;;
		*) usage; die "未知参数: $1" ;;
	esac
	shift
done

# ---------- 版本比较 ----------
# 把 x.y.z 归一化成可比较的定长数字串（补零，故字符串比较即可）。
version_key() {
	printf '%s' "$1" | awk -F. '{ printf "%05d%05d%05d", $1, $2, $3 }'
}

# version_gt A B → A 比 B 新时返回 0
version_gt() {
	[ "$1" != "$2" ] || return 1
	[ "$(version_key "$1")" -gt "$(version_key "$2")" ] 2>/dev/null
}

# ---------- 决策（纯函数，便于自测） ----------
# decide_update <已装版本> <已装提交> <最高tag版本> <main提交>
# 输出 "tag|<版本>" / "main|<提交>" / "none|"
decide_update() {
	installed_version="$1"
	installed_commit="$2"
	latest_tag="$3"
	main_sha="$4"
	if [ -n "$latest_tag" ] && { [ -z "$installed_version" ] || version_gt "$latest_tag" "$installed_version"; }; then
		printf 'tag|%s\n' "$latest_tag"
		return 0
	fi
	if [ -n "$main_sha" ] && [ "$main_sha" != "$installed_commit" ]; then
		printf 'main|%s\n' "$main_sha"
		return 0
	fi
	printf 'none|\n'
}

# ---------- 代理 ----------
detect_proxy() {
	if [ -n "${HTTPS_PROXY:-}" ] || [ -n "${https_proxy:-}" ]; then
		say "代理: 使用环境变量 ${HTTPS_PROXY:-${https_proxy:-}}"
		return 0
	fi
	configured="$(git config --get http.proxy 2>/dev/null || true)"
	if [ -z "$configured" ]; then
		configured="$(scutil --proxy 2>/dev/null | awk '
			/HTTPSEnable/ { on = $3 }
			/HTTPSProxy/  { host = $3 }
			/HTTPSPort/   { port = $3 }
			END { if (on == 1 && host != "" && port != "") print "http://" host ":" port }
		' || true)"
		if [ -n "$configured" ]; then
			say "代理: 未配置，自动采用 macOS 系统代理 $configured"
		else
			say "代理: 未检测到（若访问 GitHub 失败，请设置 HTTPS_PROXY 或 git config --global http.proxy）"
			return 0
		fi
	else
		say "代理: 使用 git config http.proxy = $configured"
	fi
	HTTPS_PROXY="$configured"
	HTTP_PROXY="$configured"
	export HTTPS_PROXY HTTP_PROXY
}

# ---------- 已安装信息 ----------
installed_version() {
	manifest="$1/node_modules/$PACKAGE/package.json"
	[ -f "$manifest" ] || return 0
	sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -1
}

# 锁文件里记着 pnpm 实际解析到的提交（tarball URL 中的 sha）。
installed_commit() {
	lock="$1/pnpm-lock.yaml"
	[ -f "$lock" ] || return 0
	sha="$(awk -v pkg="$PACKAGE" '
		$0 ~ "^ *" pkg ":$" { inside = 1; next }
		inside && /^ *version: / { print; exit }
	' "$lock" | grep -o 'tar\.gz/[0-9a-f]\{7,40\}' | head -1 | cut -d/ -f2 || true)"
	if [ -z "$sha" ]; then
		sha="$(grep -o 'tar\.gz/[0-9a-f]\{7,40\}' "$lock" | head -1 | cut -d/ -f2 || true)"
	fi
	printf '%s' "$sha"
}

current_specifier() {
	manifest="$1/package.json"
	[ -f "$manifest" ] || return 0
	sed -n 's/.*"'"$PACKAGE"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -1
}

# ---------- 远端信息 ----------
remote_tag_versions() {
	git ls-remote --tags "$REPO_URL" 2>/dev/null |
		awk '$2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ { sub("refs/tags/v", "", $2); print $2 }' |
		sort -u
}

highest_version() {
	best=""
	while IFS= read -r candidate; do
		[ -n "$candidate" ] || continue
		if [ -z "$best" ] || version_gt "$candidate" "$best"; then
			best="$candidate"
		fi
	done
	printf '%s' "$best"
}

remote_main_sha() {
	git ls-remote "$REPO_URL" refs/heads/main 2>/dev/null | awk 'NR == 1 { print $1 }'
}

short() { printf '%s' "${1:0:7}"; }

spec_for_tag() { printf 'github:%s#v%s&path:%s\n' "$REPO_SLUG" "$1" "$REPO_PATH"; }
spec_for_main() { printf 'github:%s#main&path:%s\n' "$REPO_SLUG" "$REPO_PATH"; }

# ---------- 主流程 ----------
main() {
	DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
	PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
	DSH_BIN="${DSH_BIN:-}"
	if [ -z "$DSH_BIN" ]; then
		if [ -x "$APP_CLI" ]; then
			DSH_BIN="$APP_CLI"
		else
			DSH_BIN="$(command -v dsh || true)"
		fi
	fi
	[ -n "$DSH_BIN" ] || die "找不到应用自带 CLI，请用 DSH_BIN=/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh 指定"
	if [ ! -d "$PROFILE_DIR" ]; then
		die "profile 不存在: $PROFILE_DIR（确认 DSH_HOME 与 profile 名字，或用插件页先装一次）"
	fi

	say "profile : $PROFILE  ($PROFILE_DIR)"
	say "CLI     : $DSH_BIN"
	detect_proxy

	inst_version="$(installed_version "$PROFILE_DIR")"
	inst_commit="$(installed_commit "$PROFILE_DIR")"
	specifier="$(current_specifier "$PROFILE_DIR")"
	installed_label="$(short "${inst_commit:-}")"
	[ -n "$installed_label" ] || installed_label="未知"
	say "已安装  : 版本 ${inst_version:-未知}  提交 $installed_label"
	[ -n "$specifier" ] && say "当前规范: $specifier"

	say "查询远端…"
	latest_tag="$(remote_tag_versions | highest_version)"
	main_sha="$(remote_main_sha)"
	[ -n "$latest_tag" ] || say "远端没有 vX.Y.Z 形式的 tag"
	[ -n "$main_sha" ] || die "读取远端 main 失败（网络/代理？）"
	say "远端    : 最高 tag ${latest_tag:-无}  main $(short "$main_sha")"

	action="$(decide_update "$inst_version" "$inst_commit" "$latest_tag" "$main_sha")"
	kind="${action%%|*}"
	value="${action#*|}"

	case "$kind" in
		tag)
			if [ -z "$inst_version" ]; then
				reason="尚未安装，按已发布的 tag v$value 安装"
			else
				reason="远端 tag v$value 比已安装的 $inst_version 新"
			fi
			spec="$(spec_for_tag "$value")"
			;;
		main)
			if [ -z "$inst_version" ]; then
				reason="尚未安装，按 main 最新提交安装"
			elif [ "$latest_tag" = "$inst_version" ]; then
				reason="tag 版本没有升级（都是 $inst_version），但 main 有新提交 $(short "$value")"
			else
				reason="没有比 ${inst_version} 更新的 tag，main 提交与已安装的 $(short "${inst_commit:-无}") 不同"
			fi
			spec="$(spec_for_main)"
			;;
		*)
			say "已是最新：版本 ${inst_version:-未知} 提交 $(short "${inst_commit:-}")，无需更新"
			exit 0
			;;
	esac

	say "结论    : $reason"
	say "将执行  : $DSH_BIN plugin --profile $PROFILE add '$spec'"

	if [ "$MODE" = "check" ]; then
		say "（--check 模式：未做任何改动）"
		exit 0
	fi

	if [ "$ASSUME_YES" != "yes" ]; then
		printf '确认更新？[y/N] '
		read -r answer || answer=""
		case "$answer" in
			y|Y|yes|YES) ;;
			*) say "已取消"; exit 0 ;;
		esac
	fi

	say "执行中…"
	if ! output="$("$DSH_BIN" plugin --profile "$PROFILE" add "$spec" 2>&1)"; then
		printf '%s\n' "$output" >&2
		case "$output" in
			*allowBuilds*|*"prepare script"*)
				die "pnpm 把这次安装当成需要构建的 git 依赖拦下了。按上面提示，把对应键加进 $PROFILE_DIR/pnpm-workspace.yaml 的 allowBuilds 再重试（用 tag 或 main 分支规范不会触发）。"
				;;
			*)
				die "更新失败（GitHub 不可达/代理未生效？可先跑 git config --global http.proxy http://127.0.0.1:7890）"
				;;
		esac
	fi

	after_version="$(installed_version "$PROFILE_DIR")"
	after_commit="$(installed_commit "$PROFILE_DIR")"
	say "更新完成: 版本 ${after_version:-未知} 提交 $(short "${after_commit:-}")"
	say "请重启 DeepSeek Harness 使新版本生效（host 部分不会热重载）。"
}

if [ "${BASH_SOURCE[0]:-$0}" = "$0" ]; then
	main "$@"
fi
