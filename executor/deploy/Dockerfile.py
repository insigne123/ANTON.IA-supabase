FROM python:3.12-slim
RUN pip install --no-cache-dir pandas==2.2.3 openpyxl==3.1.5 matplotlib==3.9.4 numpy==2.1.3 \
 && useradd -u 65534 -U -M -s /usr/sbin/nologin appuser || true
USER 65534:65534
CMD ["python", "--version"]
