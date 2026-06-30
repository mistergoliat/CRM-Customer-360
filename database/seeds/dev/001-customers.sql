INSERT INTO master_customer (id, firstname, lastname, email, platform_origin)
VALUES
  (1, 'Camila', 'Rojas', 'camila.rojas@example.test', 'prestashop'),
  (2, 'Diego', 'Pérez', 'diego.perez@example.test', 'whatsapp'),
  (3, 'Empresa', 'Test', 'compras@example.test', 'pos')
ON DUPLICATE KEY UPDATE
  firstname = VALUES(firstname),
  lastname = VALUES(lastname),
  email = VALUES(email),
  platform_origin = VALUES(platform_origin);
