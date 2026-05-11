(function () {
  const root = document.documentElement;
  const themeButton = document.querySelector('[data-theme-toggle]');
  let theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);

  themeButton?.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', theme);
    themeButton.setAttribute('aria-label', theme === 'dark' ? 'Helle Darstellung aktivieren' : 'Dunkle Darstellung aktivieren');
  });

  const form = document.querySelector('#intake-form');
  const customerResult = document.querySelector('[data-customer-result]');
  const statusPill = document.querySelector('[data-status-pill]');
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"][data-document-type]'));
  const fileList = document.querySelector('[data-file-list]');
  const objectCatalog = Array.isArray(window.IMMOMEDIA_OBJECTS) ? window.IMMOMEDIA_OBJECTS : [];

  const objectSelect = document.querySelector('select[data-testid="select-object-id"]');
  const objectSummary = document.querySelector('[data-object-summary]');

  const params = new URLSearchParams(window.location.search);
  const initialRequestId = params.get('requestId') || `REQ-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

  function escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setField(name, value) {
    const field = form.elements.namedItem(name);
    if (field) field.value = value || '';
  }

  function getObjectById(id) {
    return objectCatalog.find((item) => item.id === id) || null;
  }

  function populateObjectSelect() {
    if (!objectSelect) return;
    const activeObjects = objectCatalog.filter((item) => item.formActive);
    objectSelect.innerHTML = '<option value="">Bitte Projekt wählen</option>';
    activeObjects.forEach((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = `${item.name} · ${item.location} · ${item.status}`;
      objectSelect.append(option);
    });
  }

  function selectedObject() {
    return getObjectById(objectSelect?.value);
  }

  function renderObjectSummary(object) {
    if (!objectSummary) return;
    if (!object) {
      objectSummary.textContent = 'Bitte wählen Sie Ihr Wunschprojekt aus.';
      return;
    }
    objectSummary.innerHTML = `
      <strong>${escapeHtml(object.name)}</strong>
      <span>${escapeHtml(object.location)} · ${escapeHtml(object.status)}</span>
    `;
  }

  function applyObjectSelection() {
    const object = selectedObject();
    if (!object) {
      setField('objectStatus', '');
      setField('address', '');
      const hiddenObjectId = form.querySelector('input[type="hidden"][name="objectId"]');
      if (hiddenObjectId) hiddenObjectId.value = '';
      renderObjectSummary(null);
      return null;
    }
    setField('address', `${object.name}, ${object.location}`);
    setField('objectType', 'Neubauprojekt');
    setField('objectStatus', object.status || '');
    const hiddenObjectId = form.querySelector('input[type="hidden"][name="objectId"]');
    if (hiddenObjectId) hiddenObjectId.value = object.id;
    renderObjectSummary(object);
    return object;
  }

  function seedFromUrl() {
    const requestField = form.elements.namedItem('requestId');
    if (requestField) requestField.value = initialRequestId;

    const customerEmail = params.get('customerEmail');
    const objectId = params.get('objectId');
    const webhookUrl = params.get('webhookUrl');

    if (customerEmail && form.elements.namedItem('contactEmail')) {
      form.elements.namedItem('contactEmail').value = customerEmail;
    }

    // FIX: erst prüfen ob Option existiert — populateObjectSelect() muss vorher laufen
    if (objectId && objectSelect) {
      const exists = Array.from(objectSelect.options).some((o) => o.value === objectId);
      if (exists) {
        objectSelect.value = objectId;
        applyObjectSelection();
      }
    }

    if (webhookUrl && form.elements.namedItem('webhookUrl')) {
      form.elements.namedItem('webhookUrl').value = webhookUrl;
    }
  }

  function formData() {
    return Object.fromEntries(new FormData(form).entries());
  }

  function selectedFiles() {
    return fileInputs.flatMap((input) =>
      Array.from(input.files || []).map((file) => ({
        file,
        documentType: input.dataset.documentType,
        fieldName: input.dataset.documentType || 'documents'
      }))
    );
  }

  function documentMetadata() {
    return selectedFiles().map(({ file, documentType }) => ({
      type: documentType,
      name: file.name,
      size_bytes: file.size,
      mime_type: file.type || 'application/octet-stream'
    }));
  }

  function buildPayload() {
    const data = formData();
    const [streetPart, cityPart] = (data.address || '').split(',').map((item) => item.trim());
    const object = selectedObject();
    const objectId = object?.id || data.objectId || `manual-${Date.now().toString().slice(-6)}`;
    return {
      event: 'manual_intake_submitted',
      source: 'immomedia_webform',
      submitted_at: new Date().toISOString(),
      request_id: data.requestId || initialRequestId,
      property: {
        id: objectId,
        catalog_id: objectId,
        name: object?.name || '',
        location: object?.location || '',
        address: data.address || '',
        street: streetPart || '',
        city: cityPart || ''
      },
      customer_access: {
        customer_email: data.contactEmail || '',
        customer_link: buildCustomerLink()
      },
      contact: {
        name: data.contactName || '',
        email: data.contactEmail || ''
      },
      lead: {
        name: data.leadName || '',
        phone: data.leadPhone || ''
      },
      workflow: {
        priority: 'Normal',
        pdf_status: 'incoming',
        storage_path: `/Immomedia/${objectId}/${data.requestId || initialRequestId}`,
        notes: ''
      },
      documents: documentMetadata()
    };
  }

  function buildCustomerLink() {
    const data = formData();
    const url = new URL(window.location.href);
    url.search = '';
    url.searchParams.set('requestId', data.requestId || initialRequestId);
    const customerEmail = data.contactEmail;
    if (customerEmail) url.searchParams.set('customerEmail', customerEmail);
    const objectId = objectSelect?.value || data.objectId;
    if (objectId) url.searchParams.set('objectId', objectId);
    if (data.webhookUrl) url.searchParams.set('webhookUrl', data.webhookUrl);
    return url.toString();
  }

  function setResult(message, state = '') {
    if (!customerResult) return;
    customerResult.textContent = message;
    customerResult.className = `result customer-result ${state}`.trim();
  }

  function setStatus(message, isError = false) {
    if (!statusPill) return;
    statusPill.textContent = message;
    statusPill.classList.toggle('error', isError);
  }

  function renderFiles() {
    if (!fileList) return;
    const files = selectedFiles();
    if (!files.length) {
      fileList.textContent = 'Noch keine Unterlagen ausgewählt.';
      return;
    }
    const items = files
      .map(({ file, documentType }) => `<li>${documentType}: ${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB</li>`)
      .join('');
    fileList.innerHTML = `<ul>${items}</ul>`;
  }

  function validateForm() {
    const required = ['requestId', 'objectId', 'address', 'objectType', 'contactName', 'contactEmail'];
    const data = formData();
    const missing = required.filter((field) => !String(data[field] || '').trim());
    const invalidEmails = ['contactEmail'].filter(
      (field) => data[field] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data[field])
    );
    const requiredDocuments = ['id_document', 'financing_confirmation', 'reservation_confirmation'];
    const presentDocumentTypes = new Set(selectedFiles().map((entry) => entry.documentType));
    const missingDocuments = requiredDocuments.filter((type) => !presentDocumentTypes.has(type));
    const missingConsent = selectedFiles().length > 0 && !form.elements.namedItem('consent')?.checked;

    if (missing.length || invalidEmails.length || missingConsent || missingDocuments.length) {
      setStatus('Bitte prüfen', true);
      return {
        ok: false,
        message: `Bitte Pflichtfelder ausfüllen${invalidEmails.length ? ' und E-Mail-Adresse prüfen' : ''}${missingDocuments.length ? ' sowie alle drei Pflichtunterlagen hochladen' : ''}${missingConsent ? ' und Zustimmung bestätigen' : ''}.`
      };
    }
    setStatus('Valide', false);
    return { ok: true };
  }

  form?.addEventListener('input', () => {
    renderFiles();
    validateForm();
  });

  objectSelect?.addEventListener('change', () => {
    applyObjectSelection();
    validateForm();
  });

  fileInputs.forEach((input) => input.addEventListener('change', () => {
    renderFiles();
    validateForm();
  }));

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validation = validateForm();
    if (!validation.ok) {
      setResult(validation.message, 'error');
      return;
    }

    const data = formData();
    const payload = buildPayload();

    if (!data.webhookUrl) {
      setResult('Vielen Dank! Ihre Unterlagen wurden erfolgreich übermittelt. Wir melden uns in Kürze bei Ihnen.', 'success');
      return;
    }

    setResult('Unterlagen werden übermittelt ...');
    try {
      const body = new FormData();
      body.append('payload', JSON.stringify(payload));
      selectedFiles().forEach(({ file, documentType }) => {
        body.append(`document_${documentType}`, file, file.name);
      });
      const response = await fetch(data.webhookUrl, {
        method: 'POST',
        headers: { 'X-Immomedia-Mock-Source': 'webform' },
        body
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Fehler ${response.status}: ${text.slice(0, 240)}`);
      }
      setResult('Vielen Dank! Ihre Unterlagen wurden erfolgreich übermittelt. Wir melden uns in Kürze bei Ihnen.', 'success');
    } catch (error) {
      setResult(`Übermittlung fehlgeschlagen: ${error.message}`, 'error');
    }
  });

  // Reihenfolge wichtig: erst Objekte laden, dann URL-Parameter anwenden
  populateObjectSelect();
  seedFromUrl();
  if (!selectedObject() && objectCatalog.length) renderObjectSummary(null);
  renderFiles();
  validateForm();
})();
