<?php 
$I = new AcceptanceTester($scenario);
$I->wantTo('perform actions and see result');// opens front page
$I->amOnPage('/admin');
// opens /register page
$I->amOnPage('/admin/login');
$I->fillField(['name' => 'username'], 'zezinho@teste');
$I->fillField(['name' => 'password'], 'jon@mail.com');
$I->see('Login');  
$I->click('Login');
$I->see('Login');  
$I->fillField(['name' => 'username'], 'zezinho@teste');
$I->fillField(['name' => 'password'], 'b343d87e0f446388bb39e80cacf02120');
$I->see('Welcome');  
$I->click('Login');
