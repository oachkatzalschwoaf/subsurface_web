<?php
/**
 * Optional: further git servers the proxy may reach, besides the Subsurface cloud.
 * Copy this file to git-proxy.config.php (same folder) and list the host names.
 *
 * Every host listed here can be reached through your proxy by anyone who can open your
 * Topside installation (they still need their own credentials for that server). List only
 * what you use, and consider protecting the folder with a password (.htaccess).
 */
return [
    'github.com',
    // 'gitlab.com',
    // 'codeberg.org',
    // 'git.example.org',
];
