Feature: ecom
  In order to add products i must have sub_categories
  As a admin
  I need to create modifiy and delete sub_categories

 Scenario: create new categorie
 	As a admin
 	I need to be able to create a new categorie
 	Given i have categorie with name "categorie de teste" 
 	When i call categorie_save 
 	Then  i call gcategories 
 	And Then i should see that total number categories is "1"
 	


