from setuptools import setup, find_packages

with open("requirements.txt") as f:
	install_requires = f.read().strip().split("\n")

from chaotic_erpnext import __version__ as version

setup(
	name="chaotic_erpnext",
	version=version,
	description="zkSNARK + TPM Hardware Attestation for ERPNext",
	author="Chaotic Team",
	author_email="admin@example.com",
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
