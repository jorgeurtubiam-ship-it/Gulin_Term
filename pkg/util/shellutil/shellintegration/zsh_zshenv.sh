# Store the initial ZDOTDIR value
GULIN_ZDOTDIR="$ZDOTDIR"

# Source the original zshenv
[ -f ~/.zshenv ] && source ~/.zshenv

# Detect if ZDOTDIR has changed
if [ "$ZDOTDIR" != "$GULIN_ZDOTDIR" ]; then
  # If changed, manually source your custom zshrc from the original GULIN_ZDOTDIR
  [ -f "$GULIN_ZDOTDIR/.zshrc" ] && source "$GULIN_ZDOTDIR/.zshrc"
fi