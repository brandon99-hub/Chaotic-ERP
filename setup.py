from setuptools import setup, find_packages

setup(
	name='chaotic_erpnext',
	version='0.0.3',
	description='zkSNARK + TPM Hardware Attestation for ERPNext',
	author='Chaotic Team',
	author_email='admin@example.com',
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=['requests>=2.25.1']
)
