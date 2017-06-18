<?php
namespace Step\Acceptance;

class Ecom extends \AcceptanceTester{
    private $group;
    private $todos;

    public function __construct()
    {
        $I = $this;
        $this->group = new \App\Group; 
    }

/**
     * @Given i have categorie with name :arg1
     */
     public function iHaveCategorieWithName($arg1)
     {
        throw new \Codeception\Exception\Incomplete("Step `i have categorie with name :arg1` is not defined");
     }

    /**
     * @When i call categorie_save
     */
     public function iCallCategorie_save()
     {
        throw new \Codeception\Exception\Incomplete("Step `i call categorie_save` is not defined");
     }

    /**
     * @Then i call gcategories
     */
     public function iCallGcategories()
     {
        throw new \Codeception\Exception\Incomplete("Step `i call gcategories` is not defined");
     }

    /**
     * @Then Then i should see that total number categories is :arg1
     */
     public function thenIShouldSeeThatTotalNumberCategoriesIs($arg1)
     {
        throw new \Codeception\Exception\Incomplete("Step `Then i should see that total number categories is :arg1` is not defined");
     }

   
}


