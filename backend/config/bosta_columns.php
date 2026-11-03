<?php

return json_decode(
    file_get_contents(__DIR__.'/bosta_columns.json'),
    true,
    512,
    JSON_THROW_ON_ERROR,
);
