#!/bin/bash

if type update-alternatives 2>/dev/null >&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/waveterm' -a -e '/usr/bin/waveterm' -a "`readlink '/usr/bin/waveterm'`" != '/etc/alternatives/waveterm' ]; then
        rm -f '/usr/bin/waveterm'
    fi
    update-alternatives --install '/usr/bin/gulin' 'gulin' '/opt/GuLiN/gulin' 100 || ln -sf '/opt/GuLiN/gulin' '/usr/bin/gulin'
else
    ln -sf '/opt/GuLiN/gulin' '/usr/bin/gulin'
fi

chmod 4755 '/opt/GuLiN/chrome-sandbox' || true

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi
