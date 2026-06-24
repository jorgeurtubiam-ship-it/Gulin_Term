# add wsh to path, source dynamic script from wsh token
GULIN_WSHBINDIR={{.WSHBINDIR}}
export PATH="$GULIN_WSHBINDIR:$PATH"
source <(wsh token "$GULIN_SWAPTOKEN" zsh 2>/dev/null)
unset GULIN_SWAPTOKEN

# Source the original zshrc only if ZDOTDIR has not been changed
if [ "$ZDOTDIR" = "$GULIN_ZDOTDIR" ]; then
  [ -f ~/.zshrc ] && source ~/.zshrc
fi

if [[ ":$PATH:" != *":$GULIN_WSHBINDIR:"* ]]; then
  export PATH="$GULIN_WSHBINDIR:$PATH"
fi
unset GULIN_WSHBINDIR

if [[ -n ${_comps+x} ]]; then
  source <(wsh completion zsh)
fi

# fix history (macos)
if [[ "$HISTFILE" == "$GULIN_ZDOTDIR/.zsh_history" ]]; then
  HISTFILE="$HOME/.zsh_history"
fi

typeset -g _GULIN_SI_FIRSTPRECMD=1

# shell integration
_gulin_si_blocked() {
  [[ -n "$TMUX" || -n "$STY" || "$TERM" == tmux* || "$TERM" == screen* ]]
}

_gulin_si_urlencode() {
  if (( $+functions[omz_urlencode] )); then
    omz_urlencode "$1"
  else
    local s="$1"
    # Escape % first
    s=${s//\%/%25}
    # Common reserved characters in file paths
    s=${s//\ /%20}
    s=${s//\#/%23}
    s=${s//\?/%3F}
    s=${s//\&/%26}
    s=${s//\;/%3B}
    s=${s//\+/%2B}
    printf '%s' "$s"
  fi
}

_gulin_si_compmode() {
  # fzf-based completion wins
  if typeset -f _fzf_tab_complete >/dev/null 2>&1 || typeset -f _fzf_complete >/dev/null 2>&1; then
    echo "fzf"
    return
  fi

  # Check zstyle menu setting
  local _menuval
  if zstyle -s ':completion:*' menu _menuval 2>/dev/null; then
    if [[ "$_menuval" == *select* ]]; then
      echo "menu-select"
    else
      echo "menu"
    fi
    return
  fi

  echo "standard"
}

_gulin_si_osc7() {
  _gulin_si_blocked && return
  local encoded_pwd=$(_gulin_si_urlencode "$PWD")
  printf '\033]7;file://localhost%s\007' "$encoded_pwd"  # OSC 7 - current directory
}

_gulin_si_precmd() {
  local _gulin_si_status=$?
  _gulin_si_blocked && return
  # D;status for previous command (skip before first prompt)
  if (( !_GULIN_SI_FIRSTPRECMD )); then
    printf '\033]16162;D;{"exitcode":%d}\007' "$_gulin_si_status"
  else
    local uname_info=$(uname -smr 2>/dev/null)
    local omz=false
    local comp=$(_gulin_si_compmode)
    [[ -n "$ZSH" && -r "$ZSH/oh-my-zsh.sh" ]] && omz=true
    printf '\033]16162;M;{"shell":"zsh","shellversion":"%s","uname":"%s","integration":true,"omz":%s,"comp":"%s"}\007' "$ZSH_VERSION" "$uname_info" "$omz" "$comp"
    # OSC 7 only sent on first prompt - chpwd hook handles directory changes
    _gulin_si_osc7
  fi
  printf '\033]16162;A\007'
  _GULIN_SI_FIRSTPRECMD=0
}

_gulin_si_preexec() {
  _gulin_si_blocked && return
  local cmd="$1"
  local cmd_length=${#cmd}
  if [ "$cmd_length" -gt 8192 ]; then
    cmd=$(printf '# command too large (%d bytes)' "$cmd_length")
  fi
  local cmd64
  cmd64=$(printf '%s' "$cmd" | base64 2>/dev/null | tr -d '\n\r')
  if [ -n "$cmd64" ]; then
    printf '\033]16162;C;{"cmd64":"%s"}\007' "$cmd64"
  else
    printf '\033]16162;C\007'
  fi
}

typeset -g GULIN_SI_INPUTEMPTY=1

_gulin_si_inputempty() {
  _gulin_si_blocked && return
  
  local current_empty=1
  if [[ -n "$BUFFER" ]]; then
    current_empty=0
  fi
  
  if (( current_empty != GULIN_SI_INPUTEMPTY )); then
    GULIN_SI_INPUTEMPTY=$current_empty
    if (( current_empty )); then
      printf '\033]16162;I;{"inputempty":true}\007'
    else
      printf '\033]16162;I;{"inputempty":false}\007'
    fi
  fi
}

autoload -Uz add-zle-hook-widget 2>/dev/null
if (( $+functions[add-zle-hook-widget] )); then
  add-zle-hook-widget zle-line-init _gulin_si_inputempty
  add-zle-hook-widget zle-line-pre-redraw _gulin_si_inputempty
fi

autoload -U add-zsh-hook
add-zsh-hook precmd  _gulin_si_precmd
add-zsh-hook preexec _gulin_si_preexec
add-zsh-hook chpwd   _gulin_si_osc7