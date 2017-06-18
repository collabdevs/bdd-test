<?php
namespace Step\Acceptance;

class User extends \AcceptanceTester{
	private $user;
	private $todos;

    public function __construct()
    {
        $I = $this;
        $this->user = new \App\User; 
    }

    /**
     * @Given i have user with name :arg1
     */
     public function iHaveuserWithName($arg1)
     {
     	$this->user->name = $arg1;
     	return false;
     }

  
   /**
     * @When i call user_save
     */
     public function iCallUser_save()
     {
        return false;
     }

    /**
     * @Then i call users
     */
     public function iCallUsers()
     {
        return false;
     }

    /**
     * @Then Then i should see that total number users is :arg1
     */
     public function thenIShouldSeeThatTotalNumberUsersIs($arg1)
     {
       return false;
     }


}