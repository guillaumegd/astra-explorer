import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location(
    'deploy_ftp', Path(__file__).resolve().parents[1] / 'scripts/deploy-ftp.py'
)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            'FTP_HOST': 'ftp.example.test', 'FTP_USERNAME': 'test',
            'FTP_PASSWORD': 'test', 'FTP_DIRECTORY': 'astra',
        })
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def test_unsafe_destinations_fail_before_connecting(self):
        for directory in ('', '/', 'www', '../www', 'astra/../www'):
            with self.subTest(directory=directory), patch.dict(os.environ, {'FTP_DIRECTORY': directory}):
                with patch.object(deploy.ftplib, 'FTP_TLS') as client:
                    with self.assertRaises(ValueError):
                        deploy.publish()
                    client.assert_not_called()

    def test_encrypted_upload_publishes_html_last_and_preserves_old_assets(self):
        with tempfile.TemporaryDirectory() as temporary:
            previous = Path.cwd()
            os.chdir(temporary)
            try:
                Path('out/assets').mkdir(parents=True)
                Path('out/assets/app.js').write_text('test')
                Path('out/index.html').write_text('test')
                Path('out/.htaccess').write_text('RewriteEngine On')
                client = MagicMock()
                ftp = client.return_value.__enter__.return_value
                ftp.pwd.return_value = '/astra'
                with patch.object(deploy.ftplib, 'FTP_TLS', client):
                    deploy.publish()
                ftp.prot_p.assert_called_once()
                commands = [call.args[0] for call in ftp.storbinary.call_args_list]
                self.assertEqual(commands, ['STOR .htaccess', 'STOR app.js', 'STOR index.html.uploading'])
                ftp.rename.assert_called_once_with('index.html.uploading', 'index.html')
                ftp.delete.assert_not_called()
                ftp.reset_mock()
                ftp.storbinary.side_effect = OSError('interrupted')
                with patch.object(deploy.ftplib, 'FTP_TLS', client):
                    with self.assertRaises(OSError):
                        deploy.publish()
                ftp.rename.assert_not_called()
            finally:
                os.chdir(previous)


if __name__ == '__main__':
    unittest.main()
