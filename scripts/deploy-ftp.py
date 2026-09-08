"""Upload the validated static artifact to a dedicated OVH directory over SFTP."""

import paramiko
import os
from pathlib import Path
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

    with paramiko.SSHClient() as client:
        client.load_host_keys(str(Path(__file__).with_name('ovh_known_hosts')))
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        print('SFTP: connecting and authenticating with pinned host key', flush=True)
        client.connect(
            os.environ['FTP_HOST'], port=22,
            username=os.environ['FTP_USERNAME'], password=os.environ['FTP_PASSWORD'],
            look_for_keys=False, allow_agent=False, timeout=30,
            auth_timeout=30, banner_timeout=30,
        )
        with client.open_sftp() as sftp:
            sftp.get_channel().settimeout(60)
            print('SFTP: opening configured destination', flush=True)
            sftp.chdir(directory)
            destination = sftp.getcwd()
            print('SFTP: uploading static files', flush=True)
            for path in files:
                relative = path.relative_to(root)
                if relative.as_posix() == 'index.html':
                    continue
                sftp.chdir(destination)
                for part in relative.parts[:-1]:
                    try:
                        sftp.chdir(part)
                    except FileNotFoundError:
                        sftp.mkdir(part)
                        sftp.chdir(part)
                sftp.put(str(path), relative.name)

            # Publish HTML last; keep old assets for already-open browser tabs.
            sftp.chdir(destination)
            sftp.put(str(root / 'index.html'), 'index.html.uploading')
            print('SFTP: publishing index.html', flush=True)
            sftp.posix_rename('index.html.uploading', 'index.html')
    print(f'Published {len(files)} static files over SFTP.')


if __name__ == '__main__':
    try:
        publish()
    except ValueError as error:
        sys.exit(str(error))
    except (OSError, paramiko.SSHException) as error:
        # Do not echo connection details or credentials from server responses.
        detail = type(error).__name__
        print(f'SFTP failure category: {detail}', file=sys.stderr)
        sys.exit('SFTP deployment failed. Check OVH credentials, SSH host key, directory and write permissions. Previous assets were retained.')
