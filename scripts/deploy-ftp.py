"""Upload the validated static artifact to a dedicated OVH directory over FTPS."""

import ftplib
import os
from pathlib import Path
import ssl
import sys


def publish():
    required = ('FTP_HOST', 'FTP_USERNAME', 'FTP_PASSWORD', 'FTP_DIRECTORY')
    missing = [name for name in required if not os.environ.get(name, '').strip()]
    if missing:
        raise ValueError('Configure GitHub secrets/variables: ' + ', '.join(missing))

    directory = os.environ['FTP_DIRECTORY'].strip()
    parts = directory.strip('/').split('/')
    if any(part in ('', '.', '..') for part in parts) or directory.strip('/') == 'www':
        raise ValueError('FTP_DIRECTORY must be a dedicated ASTRA folder, not the FTP root or www.')
    if any(ord(char) < 32 for char in directory):
        raise ValueError('Invalid FTP_DIRECTORY.')

    root = Path('out')
    files = sorted(path for path in root.rglob('*') if path.is_file())
    if not (root / 'index.html').is_file() or not any((root / 'assets').glob('*.js')):
        raise ValueError('Missing static build: expected out/index.html and out/assets/*.js.')
    if any(path.is_symlink() for path in root.rglob('*')):
        raise ValueError('Static artifact must not contain symlinks.')

    with ftplib.FTP_TLS(context=ssl.create_default_context(), timeout=60) as ftp:
        print('FTPS: connecting to server', flush=True)
        ftp.connect(os.environ['FTP_HOST'], 21)
        print('FTPS: negotiating TLS and authenticating', flush=True)
        ftp.login(os.environ['FTP_USERNAME'], os.environ['FTP_PASSWORD'])
        print('FTPS: protecting data connection', flush=True)
        ftp.prot_p()
        # Require an existing destination, created with the OVH multisite setup.
        print('FTPS: opening configured destination', flush=True)
        ftp.cwd(directory)
        destination = ftp.pwd()
        print('FTPS: uploading static files', flush=True)
        for path in files:
            relative = path.relative_to(root)
            if relative.as_posix() == 'index.html':
                continue
            ftp.cwd(destination)
            for part in relative.parts[:-1]:
                try:
                    ftp.cwd(part)
                except ftplib.error_perm:
                    ftp.mkd(part)
                    ftp.cwd(part)
            with path.open('rb') as source:
                ftp.storbinary('STOR ' + relative.name, source)

        # Publish HTML only after all assets exist. Old assets remain available
        # to visitors who loaded the previous version; never mirror-delete.
        ftp.cwd(destination)
        with (root / 'index.html').open('rb') as source:
            ftp.storbinary('STOR index.html.uploading', source)
        print('FTPS: publishing index.html', flush=True)
        ftp.rename('index.html.uploading', 'index.html')
    print(f'Published {len(files)} static files over FTPS.')


if __name__ == '__main__':
    try:
        publish()
    except ValueError as error:
        sys.exit(str(error))
    except (OSError, ftplib.Error) as error:
        # Do not echo connection details or credentials from server responses.
        code = str(error)[:3]
        detail = f'FTP response {code}' if code.isdigit() else type(error).__name__
        print(f'FTPS failure category: {detail}', file=sys.stderr)
        sys.exit('FTPS deployment failed. Check OVH credentials, TLS, directory and write permissions. Previous assets were retained.')
